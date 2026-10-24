import { DEFAULT_MASTER_DATA } from "../constants";
import { uid } from "../format";
import { computeSS } from "../ss";
import type { AccountType, Assessment, LoginLog, ManagedUser, MasterData } from "../types";
import type { Repository } from "./repository";
import { SEED_ASSESSMENTS, SEED_LOGIN_LOGS, SEED_USERS } from "./seed";

const KEYS = {
  assessments: "fc_demo_assessments",
  users: "fc_demo_users",
  master: "fc_demo_master",
  logs: "fc_demo_login_logs",
} as const;

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T) {
  window.localStorage.setItem(key, JSON.stringify(value));
}

/** Mode Demo: data tersimpan di localStorage peramban. Audio hanya disimpan metadatanya. */
export const demoRepository: Repository = {
  async listAssessments() {
    return read<Assessment[]>(KEYS.assessments, SEED_ASSESSMENTS).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async createAssessment(input, user) {
    const all = read<Assessment[]>(KEYS.assessments, SEED_ASSESSMENTS);
    const assessment: Assessment = {
      id: uid(),
      clientCode: input.clientCode,
      clientAge: input.clientAge,
      assessmentDate: input.assessmentDate,
      caseHistory: input.caseHistory,
      speechTasks: input.speechTasks,
      disfluencyTypes: input.disfluencyTypes,
      totalSyllables: input.totalSyllables,
      stutteredSyllables: input.stutteredSyllables,
      ssPercentage: computeSS(input.stutteredSyllables, input.totalSyllables),
      therapistNotes: input.therapistNotes,
      audio: input.audioBlob
        ? { durationSeconds: input.audioDurationSeconds, sizeBytes: input.audioBlob.size, fileReference: null }
        : null,
      therapistName: user.fullName,
      createdAt: new Date().toISOString(),
    };
    write(KEYS.assessments, [assessment, ...all]);
    return assessment;
  },

  async deleteAssessment(id) {
    const all = read<Assessment[]>(KEYS.assessments, SEED_ASSESSMENTS);
    write(
      KEYS.assessments,
      all.filter((a) => a.id !== id)
    );
  },

  async listUsers() {
    const rawUsers = read<ManagedUser[]>(KEYS.users, SEED_USERS);
    // Otomatis migrasikan peran 'student' menjadi 'therapist' dan pastikan username selalu terdefinisi
    let migrated = false;
    const users = (rawUsers ?? []).map((u) => {
      const email = u.email || "";
      let baseUsername = u.username || (email ? email.split("@")[0] : `user.${u.id}`);
      const isStudent = (u.accountType as string) === "student";
      const isAdmin = u.accountType === "admin" || baseUsername.toLowerCase().includes("admin") || u.id === "demo-admin";
      const targetRole: AccountType = isAdmin ? "admin" : "therapist";

      let cleanUsername = baseUsername.replace(/\.mhs$/, ".wicara");
      let cleanEmail = email ? email.replace(/\.mhs@/, ".wicara@") : `${cleanUsername}@flunify.id`;
      let cleanFullName = u.fullName;

      // 1. Fallback username jika belum terdefinisi sama sekali pada data lawas
      if (isAdmin && !u.username) {
        cleanUsername = "aku.admin";
        cleanEmail = "aku.admin@flunify.id";
      }

      // 2. Normalisasi nama admin sistem jika masih nama lama dari seed lawas
      if (isAdmin && cleanFullName === "Admin Sistem Poltekkes") {
        cleanFullName = "Admin Flunify";
      }

      // 3. Fallback terapis jika belum terdefinisi sama sekali pada data lawas
      if (!isAdmin && !u.username) {
        cleanUsername = "terapis.wicara";
        cleanEmail = "terapis.wicara@flunify.id";
      }

      if (
        isStudent ||
        !u.username ||
        u.accountType !== targetRole ||
        cleanUsername !== u.username ||
        cleanFullName !== u.fullName
      ) {
        migrated = true;
        return {
          ...u,
          fullName: cleanFullName,
          username: cleanUsername,
          email: cleanEmail,
          accountType: targetRole,
        };
      }
      return {
        ...u,
        fullName: cleanFullName,
        username: baseUsername,
      };
    });

    if (migrated) {
      write(KEYS.users, users);
    }

    const assessments = await demoRepository.listAssessments();
    return users.map((u) => ({
      ...u,
      assessmentCount: assessments.filter((a) => a.therapistName === u.fullName).length,
    }));
  },

  addUser: async ({ fullName, username, email, password, accountType }) => {
    const users = read<ManagedUser[]>(KEYS.users, SEED_USERS);
    const cleanUsername = username.trim().toLowerCase();
    const finalEmail = (email?.trim() || `${cleanUsername}@flunify.id`).toLowerCase();

    if (users.some((u) => (u.username ?? "").toLowerCase() === cleanUsername)) {
      throw new Error(`Username '${cleanUsername}' sudah digunakan.`);
    }
    if (users.some((u) => (u.email ?? "").toLowerCase() === finalEmail)) {
      throw new Error(`Email '${finalEmail}' sudah digunakan.`);
    }

    if (password && password.trim().length < 8) {
      throw new Error("Kata sandi minimal harus 8 karakter.");
    }

    const user: ManagedUser = {
      id: uid(),
      fullName: fullName.trim(),
      username: cleanUsername,
      email: finalEmail,
      password: password || "Terapis@Flunify2026",
      accountType,
      status: "active",
      assessmentCount: 0,
      createdAt: new Date().toISOString(),
      lastLoginAt: null,
    };
    write(KEYS.users, [...users, user]);
    return user;
  },

  async updateUser(id, updates) {
    const users = read<ManagedUser[]>(KEYS.users, SEED_USERS);
    const target = users.find((u) => u.id === id);
    if (!target) throw new Error("Pengguna tidak ditemukan.");

    if (updates.password && updates.password.trim().length < 8) {
      throw new Error("Kata sandi baru minimal harus 8 karakter.");
    }

    const cleanUsername = updates.username !== undefined
      ? updates.username.trim().toLowerCase().replace(/\s+/g, ".")
      : target.username;

    if (updates.username && cleanUsername) {
      if (users.some((u) => u.id !== id && (u.username ?? "").toLowerCase() === cleanUsername)) {
        throw new Error(`Username '${cleanUsername}' sudah digunakan pengguna lain.`);
      }
    }

    const updatedEmail = updates.email !== undefined
      ? updates.email.trim().toLowerCase()
      : (cleanUsername ? `${cleanUsername}@flunify.id` : target.email);

    const updatedUser: ManagedUser = {
      ...target,
      ...updates,
      fullName: updates.fullName !== undefined ? updates.fullName.trim() : target.fullName,
      username: cleanUsername,
      email: updatedEmail,
      password: updates.password !== undefined ? updates.password : target.password,
    };

    write(
      KEYS.users,
      users.map((u) => (u.id === id ? updatedUser : u))
    );
    return updatedUser;
  },

  async deleteUser(id) {
    const users = read<ManagedUser[]>(KEYS.users, SEED_USERS);
    write(KEYS.users, users.filter((u) => u.id !== id));
  },

  async updateUserStatus(id, status) {
    const users = read<ManagedUser[]>(KEYS.users, SEED_USERS);
    write(KEYS.users, users.map((u) => (u.id === id ? { ...u, status } : u)));
  },

  async listLoginLogs() {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const allLogs = read<LoginLog[]>(KEYS.logs, SEED_LOGIN_LOGS);
    // Otomatis hapus riwayat log pengunjung yang melewati 30 hari untuk menghemat storage
    const validLogs = allLogs.filter((l) => l.timestamp >= thirtyDaysAgo);
    if (validLogs.length !== allLogs.length) {
      write(KEYS.logs, validLogs);
    }
    return validLogs.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  },

  async recordLoginLog(log) {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const logs = read<LoginLog[]>(KEYS.logs, SEED_LOGIN_LOGS).filter((l) => l.timestamp >= thirtyDaysAgo);
    const newEntry: LoginLog = {
      ...log,
      id: uid(),
      timestamp: new Date().toISOString(),
    };
    write(KEYS.logs, [newEntry, ...logs].slice(0, 50));
  },

  async getMasterData() {
    return read<MasterData>(KEYS.master, DEFAULT_MASTER_DATA);
  },

  async saveMasterData(data) {
    write(KEYS.master, data);
  },

  async getStorageUsage() {
    const assessments = await demoRepository.listAssessments();
    const withAudio = assessments.filter((a) => a.audio);
    return {
      files: withAudio.length,
      bytes: withAudio.reduce((sum, a) => sum + (a.audio?.sizeBytes ?? 0), 0),
    };
  },
};
