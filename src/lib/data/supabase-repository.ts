import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_MASTER_DATA } from "../constants";
import { AUDIO_BUCKET } from "../env";
import { computeSS } from "../ss";
import type { Assessment, ManagedUser, MasterData } from "../types";
import type { Repository } from "./repository";

interface AssessmentRow {
  id: string;
  assessment_date: string;
  case_history: string;
  therapist_notes: string;
  total_syllables: number;
  stuttered_syllables: number;
  ss_percentage: number | string;
  created_at: string;
  clients: { client_code: string; age: number } | null;
  profiles: { full_name: string } | null;
  observations: { category: "speech_task" | "disfluency"; label: string }[];
  audio_recordings: { file_reference: string; duration_seconds: number; size_bytes: number }[];
}

const ASSESSMENT_SELECT = `
  id, assessment_date, case_history, therapist_notes, total_syllables, stuttered_syllables,
  ss_percentage, created_at,
  clients ( client_code, age ),
  profiles ( full_name ),
  observations ( category, label ),
  audio_recordings ( file_reference, duration_seconds, size_bytes )
`;

function mapAssessment(row: AssessmentRow, supabase?: SupabaseClient): Assessment {
  const audio = row.audio_recordings?.[0];
  let audioUrl: string | null = null;
  if (audio?.file_reference && supabase) {
    const { data } = supabase.storage.from(AUDIO_BUCKET).getPublicUrl(audio.file_reference);
    audioUrl = data?.publicUrl ?? null;
  }
  return {
    id: row.id,
    clientCode: row.clients?.client_code ?? "-",
    clientAge: row.clients?.age ?? 0,
    assessmentDate: row.assessment_date,
    caseHistory: row.case_history,
    speechTasks: row.observations.filter((o) => o.category === "speech_task").map((o) => o.label),
    disfluencyTypes: row.observations.filter((o) => o.category === "disfluency").map((o) => o.label),
    totalSyllables: row.total_syllables,
    stutteredSyllables: row.stuttered_syllables,
    ssPercentage: Number(row.ss_percentage),
    therapistNotes: row.therapist_notes,
    audio: audio
      ? {
          durationSeconds: audio.duration_seconds,
          sizeBytes: Number(audio.size_bytes),
          fileReference: audio.file_reference,
          url: audioUrl,
        }
      : null,
    therapistName: row.profiles?.full_name ?? "-",
    createdAt: row.created_at,
  };
}

function fail(context: string, error: { message: string } | null): never {
  throw new Error(`${context}: ${error?.message ?? "Terjadi kesalahan."}`);
}

/** Backend Supabase — mengikuti skema di supabase/schema.sql (RLS menentukan data yang terlihat). */
export function createSupabaseRepository(supabase: SupabaseClient): Repository {
  return {
    async listAssessments() {
      const { data, error } = await supabase
        .from("assessments")
        .select(ASSESSMENT_SELECT)
        .order("created_at", { ascending: false });
      if (error) fail("Gagal memuat asesmen", error);
      return (data as unknown as AssessmentRow[]).map((r) => mapAssessment(r, supabase));
    },

    async createAssessment(input, user) {
      // 1. Klien (upsert berdasarkan kode klien — tanpa nama asli demi privasi).
      const { data: client, error: clientError } = await supabase
        .from("clients")
        .upsert({ client_code: input.clientCode, age: input.clientAge }, { onConflict: "client_code" })
        .select("id")
        .single();
      if (clientError || !client) fail("Gagal menyimpan data klien", clientError);

      // 2. Asesmen (ss_percentage dihitung otomatis oleh kolom generated di database).
      const { data: assessment, error: assessmentError } = await supabase
        .from("assessments")
        .insert({
          client_id: client.id,
          therapist_id: user.id,
          assessment_date: input.assessmentDate,
          case_history: input.caseHistory,
          therapist_notes: input.therapistNotes,
          total_syllables: input.totalSyllables,
          stuttered_syllables: input.stutteredSyllables,
        })
        .select("id, created_at")
        .single();
      if (assessmentError || !assessment) fail("Gagal menyimpan asesmen", assessmentError);

      // 3. Observasi (tugas bicara + jenis ketidaklancaran).
      const observations = [
        ...input.speechTasks.map((label) => ({ assessment_id: assessment.id, category: "speech_task", label })),
        ...input.disfluencyTypes.map((label) => ({ assessment_id: assessment.id, category: "disfluency", label })),
      ];
      if (observations.length) {
        const { error } = await supabase.from("observations").insert(observations);
        if (error) fail("Gagal menyimpan observasi", error);
      }

      // 4. Audio → Storage bucket privat, metadata → tabel audio_recordings.
      let audio: Assessment["audio"] = null;
      if (input.audioBlob) {
        const ext = input.audioBlob.type.includes("mp4") ? "m4a" : input.audioBlob.type.includes("ogg") ? "ogg" : "webm";
        const path = `${user.id}/${assessment.id}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from(AUDIO_BUCKET)
          .upload(path, input.audioBlob, { contentType: input.audioBlob.type || "audio/webm", upsert: false });
        if (uploadError) fail("Asesmen tersimpan, tetapi unggah audio gagal", uploadError);

        const { error } = await supabase.from("audio_recordings").insert({
          assessment_id: assessment.id,
          file_reference: path,
          duration_seconds: Math.round(input.audioDurationSeconds),
          size_bytes: input.audioBlob.size,
          mime_type: input.audioBlob.type,
        });
        const { data: publicUrlData } = supabase.storage.from(AUDIO_BUCKET).getPublicUrl(path);
        audio = {
          durationSeconds: input.audioDurationSeconds,
          sizeBytes: input.audioBlob.size,
          fileReference: path,
          url: publicUrlData?.publicUrl ?? null,
        };
      }

      return {
        id: assessment.id,
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
        audio,
        therapistName: user.fullName,
        createdAt: assessment.created_at,
      };
    },

    async deleteAssessment(id) {
      const { error } = await supabase.from("assessments").delete().eq("id", id);
      if (error) fail("Gagal menghapus asesmen", error);
    },

    async listUsers() {
      let localPasswords: Record<string, string> = {};
      try {
        if (typeof window !== "undefined") {
          const raw = window.localStorage.getItem("flunify_passwords_cache");
          if (raw) localPasswords = JSON.parse(raw);
        }
      } catch {
        // Abaikan kegagalan baca localStorage
      }

      const [{ data: profiles, error }, { data: counts }] = await Promise.all([
        supabase.from("profiles").select("*").order("created_at"),
        supabase.from("assessments").select("therapist_id"),
      ]);
      if (error) fail("Gagal memuat pengguna", error);
      const tally = new Map<string, number>();
      (counts ?? []).forEach((r: { therapist_id: string }) => tally.set(r.therapist_id, (tally.get(r.therapist_id) ?? 0) + 1));
      return (profiles ?? []).map(
        (p): ManagedUser => {
          const cleanUser = (p as unknown as { username?: string }).username || (p.email ? p.email.split("@")[0] : `user.${p.id}`);
          const pass = (p as unknown as { raw_password?: string }).raw_password || localPasswords[p.id] || localPasswords[cleanUser] || (p.account_type === "admin" ? "Poltekkes@Admin2026" : "Terapis@Flunify2026");
          return {
            id: p.id,
            fullName: p.full_name,
            username: cleanUser,
            email: p.email,
            password: pass,
            accountType: p.account_type,
            status: p.status,
            assessmentCount: tally.get(p.id) ?? 0,
            createdAt: p.created_at,
            lastLoginAt: null,
          };
        },
      );
    },

    addUser: async ({ fullName, username, email, accountType, password }) => {
      const cleanUsername = username.trim().toLowerCase().replace(/\s+/g, ".");
      const finalEmail = (email?.trim() || `${cleanUsername}@flunify.id`).toLowerCase();
      const initialPassword = password?.trim() || "Terapis@Flunify2026";

      // 1. Simpan password ke cache lokal
      try {
        if (typeof window !== "undefined") {
          const raw = window.localStorage.getItem("flunify_passwords_cache");
          const cache = raw ? JSON.parse(raw) : {};
          cache[cleanUsername] = initialPassword;
          window.localStorage.setItem("flunify_passwords_cache", JSON.stringify(cache));
        }
      } catch {
        // Abaikan
      }

      // 2. Coba daftarkan via RPC admin_create_user (agar otomatis terdaftar di auth.users & profiles)
      try {
        const { data: rpcId, error: rpcError } = await supabase.rpc("admin_create_user", {
          p_email: finalEmail,
          p_password: initialPassword,
          p_full_name: fullName.trim(),
          p_username: cleanUsername,
          p_role: accountType,
        });

        if (!rpcError && rpcId) {
          try {
            if (typeof window !== "undefined") {
              const raw = window.localStorage.getItem("flunify_passwords_cache");
              const cache = raw ? JSON.parse(raw) : {};
              cache[rpcId as string] = initialPassword;
              cache[cleanUsername] = initialPassword;
              window.localStorage.setItem("flunify_passwords_cache", JSON.stringify(cache));
            }
          } catch {}

          return {
            id: rpcId as string,
            fullName: fullName.trim(),
            username: cleanUsername,
            email: finalEmail,
            password: initialPassword,
            accountType,
            status: "active",
            assessmentCount: 0,
            createdAt: new Date().toISOString(),
          };
        }
      } catch {
        // Lanjutkan ke direct insert jika RPC belum terpasang
      }

      // 3. Fallback: simpan langsung ke public.profiles
      const insertPayload: Record<string, unknown> = {
        full_name: fullName.trim(),
        username: cleanUsername,
        email: finalEmail,
        account_type: accountType,
        status: "active",
        raw_password: initialPassword,
      };

      let { data, error } = await supabase
        .from("profiles")
        .insert(insertPayload)
        .select()
        .single();

      if (error && insertPayload.raw_password) {
        delete insertPayload.raw_password;
        const retry = await supabase
          .from("profiles")
          .insert(insertPayload)
          .select()
          .single();
        data = retry.data;
        error = retry.error;
      }

      if (error || !data) {
        const msg = error?.message?.toLowerCase() || "";
        if (msg.includes("unique") || msg.includes("profiles_username_key") || msg.includes("duplicate")) {
          throw new Error(`Username '@${cleanUsername}' sudah digunakan pengguna lain.`);
        }
        fail("Gagal menambahkan profil", error);
      }

      try {
        if (typeof window !== "undefined") {
          const raw = window.localStorage.getItem("flunify_passwords_cache");
          const cache = raw ? JSON.parse(raw) : {};
          cache[data.id] = initialPassword;
          cache[cleanUsername] = initialPassword;
          window.localStorage.setItem("flunify_passwords_cache", JSON.stringify(cache));
        }
      } catch {}

      return {
        id: data.id,
        fullName: data.full_name,
        username: (data as unknown as { username?: string }).username || cleanUsername,
        email: data.email,
        password: initialPassword,
        accountType: data.account_type,
        status: data.status,
        assessmentCount: 0,
        createdAt: data.created_at,
      };
    },

    async updateUser(id, updates) {
      const cleanUser = updates.username
        ? updates.username.trim().toLowerCase().replace(/\s+/g, ".")
        : undefined;

      if (updates.password && updates.password.trim().length >= 8) {
        const newPass = updates.password.trim();
        // 1. Simpan di cache lokal
        try {
          if (typeof window !== "undefined") {
            const raw = window.localStorage.getItem("flunify_passwords_cache");
            const cache = raw ? JSON.parse(raw) : {};
            cache[id] = newPass;
            if (cleanUser) cache[cleanUser] = newPass;
            window.localStorage.setItem("flunify_passwords_cache", JSON.stringify(cache));
          }
        } catch {
          // Abaikan
        }

        // 2. Update via RPC ke auth.users dan profiles
        try {
          await supabase.rpc("admin_update_user_password", {
            p_user_id: id,
            p_new_password: newPass,
          });
        } catch {
          // Abaikan jika RPC belum terpasang
        }
      }

      const payload: Record<string, unknown> = {};
      if (updates.fullName !== undefined) payload.full_name = updates.fullName.trim();
      if (cleanUser !== undefined) {
        payload.username = cleanUser;
        if (!updates.email || updates.email.endsWith("@flunify.id")) {
          payload.email = `${cleanUser}@flunify.id`;
        }
      }
      if (updates.email !== undefined && !payload.email) {
        payload.email = updates.email.trim().toLowerCase();
      }
      if (updates.accountType !== undefined) payload.account_type = updates.accountType;
      if (updates.status !== undefined) payload.status = updates.status;
      if (updates.password && updates.password.trim().length >= 8) {
        payload.raw_password = updates.password.trim();
      }

      let { data, error } = await supabase
        .from("profiles")
        .update(payload)
        .eq("id", id)
        .select()
        .single();

      if (error && payload.raw_password) {
        delete payload.raw_password;
        const retry = await supabase
          .from("profiles")
          .update(payload)
          .eq("id", id)
          .select()
          .single();
        data = retry.data;
        error = retry.error;
      }

      if (error || !data) {
        const msg = error?.message?.toLowerCase() || "";
        if (msg.includes("unique") || msg.includes("profiles_username_key") || msg.includes("duplicate")) {
          throw new Error("Username tersebut sudah digunakan oleh akun lain.");
        }
        fail("Gagal memperbarui pengguna", error);
      }

      const returnedPassword = updates.password ? updates.password.trim() : (data as unknown as { raw_password?: string }).raw_password;
      return {
        id: data.id,
        fullName: data.full_name,
        username: (data as unknown as { username?: string }).username || (data.email ? data.email.split("@")[0] : ""),
        email: data.email,
        password: returnedPassword,
        accountType: data.account_type,
        status: data.status,
        assessmentCount: 0,
        createdAt: data.created_at,
      };
    },

    async deleteUser(id) {
      try {
        await supabase.rpc("admin_delete_user", { p_user_id: id });
      } catch {
        // Abaikan jika RPC belum terpasang
      }
      const { error } = await supabase.from("profiles").delete().eq("id", id);
      if (error) fail("Gagal menghapus pengguna", error);
    },

    async updateUserStatus(id, status) {
      const { error } = await supabase.from("profiles").update({ status }).eq("id", id);
      if (error) fail("Gagal memperbarui status", error);
    },

    async listLoginLogs() {
      try {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        // Otomatis bersihkan catatan riwayat yang telah lewat dari 30 hari untuk menghemat database
        await supabase
          .from("login_history")
          .delete()
          .lt("logged_at", thirtyDaysAgo);

        const { data, error } = await supabase
          .from("login_history")
          .select("id, username, role, status, ip_address, user_agent, logged_at")
          .gte("logged_at", thirtyDaysAgo)
          .order("logged_at", { ascending: false })
          .limit(100);
        if (error || !data) return [];
        return data.map((d: any) => ({
          id: d.id,
          username: d.username,
          role: d.role,
          status: d.status,
          ipAddress: d.ip_address ?? "-",
          userAgent: d.user_agent ?? "-",
          timestamp: d.logged_at,
        }));
      } catch {
        return [];
      }
    },

    async recordLoginLog(log) {
      try {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        // Bersihkan data lampau saat ada entri baru masuk
        await supabase
          .from("login_history")
          .delete()
          .lt("logged_at", thirtyDaysAgo);

        await supabase.from("login_history").insert({
          username: log.username,
          role: log.role,
          status: log.status,
          ip_address: log.ipAddress,
          user_agent: log.userAgent,
        });
      } catch {
        // Toleransi jika tabel login_history belum dibuat di supabase
      }
    },

    async getMasterData() {
      const { data, error } = await supabase
        .from("master_options")
        .select("category, label, sort_order")
        .order("sort_order");
      if (error) fail("Gagal memuat master data", error);
      if (!data?.length) return DEFAULT_MASTER_DATA;
      return {
        speechTasks: data.filter((d) => d.category === "speech_task").map((d) => d.label),
        disfluencyTypes: data.filter((d) => d.category === "disfluency").map((d) => d.label),
      };
    },

    async saveMasterData(master: MasterData) {
      const { error: deleteError } = await supabase.from("master_options").delete().in("category", ["speech_task", "disfluency"]);
      if (deleteError) fail("Gagal memperbarui master data", deleteError);
      const rows = [
        ...master.speechTasks.map((label, i) => ({ category: "speech_task", label, sort_order: i })),
        ...master.disfluencyTypes.map((label, i) => ({ category: "disfluency", label, sort_order: i })),
      ];
      const { error } = await supabase.from("master_options").insert(rows);
      if (error) fail("Gagal menyimpan master data", error);
    },

    async getStorageUsage() {
      const { data, error } = await supabase.from("audio_recordings").select("size_bytes");
      if (error) fail("Gagal memuat penggunaan penyimpanan", error);
      return {
        files: data?.length ?? 0,
        bytes: (data ?? []).reduce((sum, r: { size_bytes: number }) => sum + Number(r.size_bytes), 0),
      };
    },
  };
}
