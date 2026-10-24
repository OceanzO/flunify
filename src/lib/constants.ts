import type { AppUser, MasterData, Role } from "./types";

export const DEMO_COOKIE = "fc_demo_session";
export const ROLE_COOKIE = "fc_active_role";
export const DEFAULT_CREDENTIALS = {
  therapist: {
    username: "terapis.wicara",
    password: "Terapis@Flunify2026",
    email: "terapis.wicara@flunify.id",
    fullName: "Amanda Pratiwi, A.Md.Kes",
    title: "Terapis Wicara",
  },
  admin: {
    username: "aku.admin",
    password: "Poltekkes@Admin2026",
    email: "aku.admin@flunify.id",
    fullName: "Admin Flunify",
    title: "Administrator",
  },
} as const;

export const DEMO_PASSWORD = DEFAULT_CREDENTIALS.therapist.password;

export const DEMO_USERS: Record<Role, AppUser> = {
  therapist: {
    id: "demo-therapist",
    email: DEFAULT_CREDENTIALS.therapist.email,
    fullName: DEFAULT_CREDENTIALS.therapist.fullName,
    title: DEFAULT_CREDENTIALS.therapist.title,
    role: "therapist",
  },
  admin: {
    id: "demo-admin",
    email: DEFAULT_CREDENTIALS.admin.email,
    fullName: DEFAULT_CREDENTIALS.admin.fullName,
    title: DEFAULT_CREDENTIALS.admin.title,
    role: "admin",
  },
};

export const DEFAULT_MASTER_DATA: MasterData = {
  speechTasks: ["Bicara spontan", "Bercerita", "Menjawab pertanyaan", "Membaca"],
  disfluencyTypes: [
    "Pengulangan bunyi/suku kata",
    "Pengulangan kata utuh",
    "Pengulangan frasa",
    "Pemanjangan bunyi (prolongation)",
    "Blocking",
    "Interjeksi / jeda",
    "Perilaku penyerta",
  ],
};

export const ROLE_LABEL: Record<Role, string> = {
  therapist: "Mode Terapis",
  admin: "Mode Admin",
};

export function homeFor(role: Role): string {
  return role === "admin" ? "/admin" : "/dashboard";
}
