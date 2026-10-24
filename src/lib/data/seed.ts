import { DEFAULT_MASTER_DATA, DEMO_USERS } from "../constants";
import { computeSS } from "../ss";
import type { Assessment, ManagedUser } from "../types";

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function seedAssessment(
  id: string,
  clientCode: string,
  clientAge: number,
  ago: number,
  total: number,
  stuttered: number,
  tasks: number[],
  disfluencies: number[],
  caseHistory: string,
  durationSeconds: number,
): Assessment {
  const date = daysAgo(ago);
  return {
    id,
    clientCode,
    clientAge,
    assessmentDate: date,
    caseHistory,
    speechTasks: tasks.map((i) => DEFAULT_MASTER_DATA.speechTasks[i]),
    disfluencyTypes: disfluencies.map((i) => DEFAULT_MASTER_DATA.disfluencyTypes[i]),
    totalSyllables: total,
    stutteredSyllables: stuttered,
    ssPercentage: computeSS(stuttered, total),
    therapistNotes: "",
    audio: { durationSeconds, sizeBytes: durationSeconds * 6_000, fileReference: null },
    therapistName: DEMO_USERS.therapist.fullName,
    createdAt: `${date}T09:30:00.000Z`,
  };
}

export const SEED_ASSESSMENTS: Assessment[] = [
  seedAssessment("seed-1", "C001", 7, 1, 312, 19, [0, 1], [0, 3], "Orang tua melaporkan anak sering mengulang suku kata awal sejak usia 4 tahun.", 184),
  seedAssessment("seed-2", "C002", 12, 3, 405, 41, [0, 2, 3], [0, 4, 6], "Keluhan blocking saat membaca nyaring di kelas.", 240),
  seedAssessment("seed-3", "C003", 24, 6, 520, 13, [0, 3], [1, 5], "Mahasiswa, merasa tidak lancar saat presentasi.", 302),
  seedAssessment("seed-4", "C001", 7, 14, 298, 24, [1], [0, 3, 4], "Asesmen awal sebelum program terapi.", 160),
  seedAssessment("seed-5", "C004", 5, 20, 210, 9, [0, 1], [0, 1], "Rujukan dari dokter anak, ketidaklancaran muncul 6 bulan terakhir.", 135),
];

import { DEFAULT_CREDENTIALS } from "../constants";
import type { LoginLog } from "../types";

export const SEED_USERS: ManagedUser[] = [
  {
    id: DEMO_USERS.admin.id,
    fullName: DEFAULT_CREDENTIALS.admin.fullName,
    username: DEFAULT_CREDENTIALS.admin.username,
    email: DEFAULT_CREDENTIALS.admin.email,
    password: DEFAULT_CREDENTIALS.admin.password,
    accountType: "admin",
    status: "active",
    assessmentCount: 0,
    createdAt: daysAgo(120),
    lastLoginAt: daysAgo(0) + "T14:20:00.000Z",
  },
  {
    id: DEMO_USERS.therapist.id,
    fullName: DEFAULT_CREDENTIALS.therapist.fullName,
    username: DEFAULT_CREDENTIALS.therapist.username,
    email: DEFAULT_CREDENTIALS.therapist.email,
    password: DEFAULT_CREDENTIALS.therapist.password,
    accountType: "therapist",
    status: "active",
    assessmentCount: 5,
    createdAt: daysAgo(90),
    lastLoginAt: daysAgo(0) + "T10:15:00.000Z",
  },
  {
    id: "u-3",
    fullName: "Dimas Saputra, S.Tr.Kes",
    username: "dimas.wicara",
    email: "dimas.wicara@flunify.id",
    password: "Terapis@2026",
    accountType: "therapist",
    status: "active",
    assessmentCount: 2,
    createdAt: daysAgo(60),
    lastLoginAt: daysAgo(2) + "T16:45:00.000Z",
  },
  {
    id: "u-4",
    fullName: "Nabila Putri, S.Tr.Kes",
    username: "nabila.wicara",
    email: "nabila.wicara@flunify.id",
    password: "Terapis@Flunify2026",
    accountType: "therapist",
    status: "active",
    assessmentCount: 1,
    createdAt: daysAgo(30),
    lastLoginAt: daysAgo(3) + "T09:30:00.000Z",
  },
  {
    id: "u-5",
    fullName: "Fajar Ramadhan, A.Md.Kes",
    username: "fajar.wicara",
    email: "fajar.wicara@flunify.id",
    password: "Terapis@Flunify2026",
    accountType: "therapist",
    status: "inactive",
    assessmentCount: 0,
    createdAt: daysAgo(25),
    lastLoginAt: null,
  },
];

export const SEED_LOGIN_LOGS: LoginLog[] = [
  {
    id: "log-1",
    username: "aku.admin",
    fullName: "Admin Flunify",
    role: "admin",
    status: "success",
    ipAddress: "192.168.1.10 (Internal Poltekkes)",
    userAgent: "Chrome 122.0 / Windows 11",
    timestamp: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
    message: "Login autentikasi admin berhasil",
  },
  {
    id: "log-2",
    username: "terapis.wicara",
    fullName: "Amanda Pratiwi, A.Md.Kes",
    role: "therapist",
    status: "success",
    ipAddress: "192.168.1.42 (Klinik Wicara)",
    userAgent: "Edge 121.0 / Windows 10",
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
    message: "Login portal klinis terapis berhasil",
  },
  {
    id: "log-3",
    username: "terapis.wicara",
    fullName: "Amanda Pratiwi, A.Md.Kes",
    role: "therapist",
    status: "failed",
    ipAddress: "192.168.1.42 (Klinik Wicara)",
    userAgent: "Edge 121.0 / Windows 10",
    timestamp: new Date(Date.now() - 1000 * 60 * 65 * 2).toISOString(),
    message: "Kata sandi salah saat mencoba login",
  },
  {
    id: "log-4",
    username: "dimas.wicara",
    fullName: "Dimas Saputra, S.Tr.Kes",
    role: "therapist",
    status: "success",
    ipAddress: "114.124.200.15 (Mobile Telkomsel)",
    userAgent: "Safari / iOS 17.2",
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString(),
    message: "Sesi terautentikasi",
  },
  {
    id: "log-5",
    username: "guest.attempt",
    role: "therapist",
    status: "failed",
    ipAddress: "36.85.12.98",
    userAgent: "Firefox 122.0 / Linux",
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString(),
    message: "Akun tidak terdaftar di sistem",
  },
];

