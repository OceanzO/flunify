"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  History,
  KeyRound,
  Loader2,
  Lock,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Stethoscope,
  Trash2,
  User,
  UserCheck,
  UserCog,
  UserPlus,
  UserX,
  Users,
  X,
} from "lucide-react";
import { Badge, EmptyState, PageHeader, Skeleton, StatCard } from "@/components/ui";
import { useAuth, useSession } from "@/lib/auth/AuthContext";
import { useRepository } from "@/lib/data/useRepository";
import { cn, formatDate, initials } from "@/lib/format";
import type { AccountStatus, AccountType, LoginLog, ManagedUser } from "@/lib/types";

const ROLE_LABELS: Record<AccountType, { label: string; tone: "brand" | "navy" | "warning"; icon: typeof Stethoscope }> = {
  therapist: { label: "Terapis Wicara", tone: "brand", icon: Stethoscope },
  student: { label: "Terapis Wicara", tone: "brand", icon: Stethoscope },
  admin: { label: "Administrator", tone: "warning", icon: Shield },
};

export function UsersManagement() {
  const repo = useRepository();
  const session = useSession();
  const activeAdminEmail = session?.user.email?.toLowerCase();

  const [activeTab, setActiveTab] = useState<"users" | "logs">("users");
  const [users, setUsers] = useState<ManagedUser[] | null>(null);
  const [logs, setLogs] = useState<LoginLog[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  // Filter Pengguna
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");

  // Filter Log
  const [logStatusFilter, setLogStatusFilter] = useState<string>("all");
  const [logSearch, setLogSearch] = useState("");

  // Modal Tambah Pengguna
  const [showAddModal, setShowAddModal] = useState(false);
  const [addFullName, setAddFullName] = useState("");
  const [addUsername, setAddUsername] = useState("");
  const [addPassword, setAddPassword] = useState("");
  const [addEmail, setAddEmail] = useState("");
  const [addAccountType, setAddAccountType] = useState<AccountType>("therapist");
  const [submittingAdd, setSubmittingAdd] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Modal Edit / Reset Password Pengguna
  const [editingUser, setEditingUser] = useState<ManagedUser | null>(null);
  const [editFullName, setEditFullName] = useState("");
  const [editUsername, setEditUsername] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editAccountType, setEditAccountType] = useState<AccountType>("therapist");
  const [editStatus, setEditStatus] = useState<AccountStatus>("active");
  const [submittingEdit, setSubmittingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Modal Konfirmasi Hapus
  const [deletingUser, setDeletingUser] = useState<ManagedUser | null>(null);
  const [submittingDelete, setSubmittingDelete] = useState(false);

  // UI helpers
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const loadData = () => {
    repo
      .listUsers()
      .then((data) => setUsers(data))
      .catch((e: Error) => setError(e.message));

    if (repo.listLoginLogs) {
      repo
        .listLoginLogs()
        .then((l) => setLogs(l))
        .catch(() => setLogs([]));
    }
  };

  useEffect(() => {
    loadData();
  }, [repo]);

  // Tampilkan notifikasi sesaat
  const notifySuccess = (msg: string) => {
    setSuccessNotice(msg);
    setTimeout(() => setSuccessNotice(null), 4000);
  };

  // Filter pengguna
  const filteredUsers = useMemo(() => {
    const list = users ?? [];
    const q = query.trim().toLowerCase();
    return list.filter((u) => {
      const matchQuery =
        !q ||
        u.fullName.toLowerCase().includes(q) ||
        (u.username && u.username.toLowerCase().includes(q)) ||
        u.email.toLowerCase().includes(q);
      const matchRole = roleFilter === "all" || u.accountType === roleFilter;
      return matchQuery && matchRole;
    });
  }, [users, query, roleFilter]);

  // Filter login logs
  const filteredLogs = useMemo(() => {
    const list = logs ?? [];
    const q = logSearch.trim().toLowerCase();
    return list.filter((l) => {
      const matchStatus = logStatusFilter === "all" || l.status === logStatusFilter;
      const matchQuery =
        !q ||
        l.username.toLowerCase().includes(q) ||
        (l.fullName && l.fullName.toLowerCase().includes(q)) ||
        l.ipAddress.toLowerCase().includes(q) ||
        (l.message && l.message.toLowerCase().includes(q));
      return matchStatus && matchQuery;
    });
  }, [logs, logStatusFilter, logSearch]);

  // Statistik Pengguna
  const userStats = useMemo(() => {
    const list = users ?? [];
    return {
      total: list.length,
      therapists: list.filter((u) => u.accountType === "therapist" || u.accountType === "student").length,
      admins: list.filter((u) => u.accountType === "admin").length,
    };
  }, [users]);

  // Statistik Log
  const logStats = useMemo(() => {
    const list = logs ?? [];
    return {
      total: list.length,
      success: list.filter((l) => l.status === "success").length,
      failed: list.filter((l) => l.status === "failed").length,
    };
  }, [logs]);

  // Buka Modal Edit Pengguna
  function openEditModal(user: ManagedUser) {
    setEditingUser(user);
    setEditFullName(user.fullName);
    setEditUsername(user.username || user.email.split("@")[0]);
    setEditEmail(user.email);
    setEditPassword(user.password || "");
    setEditAccountType(user.accountType);
    setEditStatus(user.status);
    setEditError(null);
  }

  // Tambah Pengguna Baru
  async function handleAddUser(e: FormEvent) {
    e.preventDefault();
    if (!addFullName.trim() || !addUsername.trim()) {
      setAddError("Nama lengkap dan username wajib diisi.");
      return;
    }
    if (addPassword.trim() && addPassword.trim().length < 8) {
      setAddError("Kata sandi awal harus memiliki minimal 8 karakter demi keamanan.");
      return;
    }
    if (!repo.addUser) {
      setAddError("Fitur penambahan akun tidak didukung di mode ini.");
      return;
    }

    setSubmittingAdd(true);
    setAddError(null);
    try {
      await repo.addUser({
        fullName: addFullName.trim(),
        username: addUsername.trim().toLowerCase(),
        password: addPassword.trim() || "Terapis@Flunify2026",
        email: addEmail.trim() || undefined,
        accountType: addAccountType,
      });
      setShowAddModal(false);
      setAddFullName("");
      setAddUsername("");
      setAddPassword("");
      setAddEmail("");
      setAddAccountType("therapist");
      notifySuccess(`Akun @${addUsername.trim().toLowerCase()} berhasil ditambahkan.`);
      loadData();
    } catch (err: unknown) {
      setAddError(err instanceof Error ? err.message : "Gagal menambahkan akun.");
    } finally {
      setSubmittingAdd(false);
    }
  }

  // Simpan Perubahan Pengguna
  async function handleSaveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editingUser) return;
    if (!editFullName.trim() || !editUsername.trim()) {
      setEditError("Nama lengkap dan username tidak boleh kosong.");
      return;
    }
    if (editPassword.trim() && editPassword.trim().length < 8) {
      setEditError("Kata sandi baru harus memiliki minimal 8 karakter demi keamanan.");
      return;
    }

    const cleanUsername = editUsername.trim().toLowerCase().replace(/\s+/g, ".");
    const cleanEmail = editingUser.email?.endsWith("@flunify.id")
      ? `${cleanUsername}@flunify.id`
      : (editEmail.trim().toLowerCase() || `${cleanUsername}@flunify.id`);

    setSubmittingEdit(true);
    setEditError(null);
    try {
      if (repo.updateUser) {
        await repo.updateUser(editingUser.id, {
          fullName: editFullName.trim(),
          username: cleanUsername,
          email: cleanEmail,
          password: editPassword ? editPassword.trim() : editingUser.password,
          accountType: editAccountType,
          status: editStatus,
        });
      } else {
        await repo.updateUserStatus(editingUser.id, editStatus);
      }
      setEditingUser(null);
      notifySuccess(`Data akun @${cleanUsername} berhasil diperbarui.`);
      loadData();
    } catch (err: unknown) {
      setEditError(err instanceof Error ? err.message : "Gagal memperbarui data pengguna.");
    } finally {
      setSubmittingEdit(false);
    }
  }

  // Hapus Pengguna
  async function handleDeleteUser() {
    if (!deletingUser) return;
    setSubmittingDelete(true);
    try {
      if (repo.deleteUser) {
        await repo.deleteUser(deletingUser.id);
        notifySuccess(`Akun @${deletingUser.username || deletingUser.email} telah dihapus.`);
        setDeletingUser(null);
        loadData();
      } else {
        throw new Error("Penghapusan akun tidak didukung pada mode repositori ini.");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Gagal menghapus pengguna.");
      setDeletingUser(null);
    } finally {
      setSubmittingDelete(false);
    }
  }

  // Toggle Status Aktif / Nonaktif
  async function toggleStatus(user: ManagedUser) {
    const nextStatus: AccountStatus = user.status === "active" ? "inactive" : "active";
    setActionLoadingId(user.id);
    try {
      await repo.updateUserStatus(user.id, nextStatus);
      setUsers((prev) =>
        prev ? prev.map((u) => (u.id === user.id ? { ...u, status: nextStatus } : u)) : null,
      );
      notifySuccess(`Status @${user.username || user.email} diubah menjadi ${nextStatus === "active" ? "Aktif" : "Nonaktif"}.`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Gagal memperbarui status.");
    } finally {
      setActionLoadingId(null);
    }
  }

  const handleCopyPassword = (userId: string, pass: string) => {
    navigator.clipboard.writeText(pass);
    setCopiedId(userId);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const isLoading = users === null;

  return (
    <>
      <PageHeader
        eyebrow="Panel Administrator"
        title="Manajemen Pengguna & Riwayat"
        description="Kelola akun terapis wicara, ubah kata sandi, hapus akun, dan monitor riwayat login secara menyeluruh."
        actions={
          <div className="flex items-center gap-2">
            <button
              id="refresh-data"
              type="button"
              onClick={loadData}
              className="btn border border-line bg-white hover:bg-canvas text-navy text-xs py-2 px-3.5"
              title="Segarkan data"
            >
              <RefreshCw className="h-4 w-4" /> Segarkan
            </button>
            {repo.addUser && (
              <button
                id="btn-add-user"
                type="button"
                onClick={() => setShowAddModal(true)}
                className="btn-primary text-xs py-2 px-3.5"
              >
                <UserPlus className="h-4 w-4" /> Tambah Pengguna
              </button>
            )}
          </div>
        }
      />

      {/* Tab Navigasi Admin */}
      <div className="mb-6 flex items-center gap-2 border-b border-line">
        <button
          type="button"
          onClick={() => setActiveTab("users")}
          className={cn(
            "flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-bold transition-all",
            activeTab === "users"
              ? "border-brand text-brand"
              : "border-transparent text-muted hover:border-line hover:text-navy"
          )}
        >
          <Users className="h-4 w-4" />
          Manajemen Akun Terapis ({users?.length ?? 0})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("logs")}
          className={cn(
            "flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-bold transition-all",
            activeTab === "logs"
              ? "border-brand text-brand"
              : "border-transparent text-muted hover:border-line hover:text-navy"
          )}
        >
          <History className="h-4 w-4" />
          Riwayat Login & Audit ({logs?.length ?? 0})
        </button>
      </div>

      {/* Banner Pesan Sukses / Error */}
      {successNotice && (
        <div
          role="status"
          className="mb-6 flex items-center justify-between rounded-xl border border-success/20 bg-success-light px-4 py-3 text-sm font-semibold text-success animate-fade-up"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{successNotice}</span>
          </div>
          <button type="button" onClick={() => setSuccessNotice(null)} className="text-success/70 hover:text-success">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="mb-6 flex items-start gap-2 rounded-xl border border-danger/20 bg-danger-light p-4 text-sm text-danger animate-fade-up"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {/* ============================================================== */}
      {/* TAB 1: MANAJEMEN AKUN TERAPIS & ADMIN                          */}
      {/* ============================================================== */}
      {activeTab === "users" && (
        <div className="space-y-6">
          {/* Metrik Akun */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard icon={Users} label="Total Akun" value={userStats.total} tone="navy" delay={0} />
            <StatCard icon={Stethoscope} label="Terapis Wicara" value={userStats.therapists} tone="brand" delay={50} />
            <StatCard icon={Shield} label="Administrator" value={userStats.admins} tone="warning" delay={100} />
          </div>

          {/* Filter & Tabel Akun */}
          <section className="card overflow-hidden">
            <div className="flex flex-col gap-3 border-b border-line p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <label className="relative block w-full sm:w-72">
                  <span className="sr-only">Cari pengguna</span>
                  <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" />
                  <input
                    id="search-users"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Cari nama atau username..."
                    className="input py-2 pl-9"
                  />
                </label>

                <select
                  id="filter-role"
                  value={roleFilter}
                  onChange={(e) => setRoleFilter(e.target.value)}
                  className="input w-auto py-2 pr-8 text-xs font-semibold"
                  aria-label="Filter peran pengguna"
                >
                  <option value="all">Semua Peran</option>
                  <option value="therapist">Terapis Wicara</option>
                  <option value="admin">Administrator</option>
                </select>
              </div>

              <p className="text-xs font-semibold text-muted">
                Menampilkan {filteredUsers.length} dari {users?.length ?? 0} akun
              </p>
            </div>

            {isLoading ? (
              <div className="space-y-3 p-5">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-12" />
                ))}
              </div>
            ) : filteredUsers.length === 0 ? (
              <EmptyState
                icon={Users}
                title={query || roleFilter !== "all" ? "Pengguna tidak ditemukan" : "Belum ada akun"}
                description={
                  query || roleFilter !== "all"
                    ? "Cobalah kata kunci lain atau ubah filter peran."
                    : "Tambahkan akun terapis baru menggunakan tombol di atas."
                }
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="bg-canvas/70 text-xs font-bold tracking-wide text-muted uppercase border-b border-line">
                    <tr>
                      <th className="px-5 py-3.5 whitespace-nowrap">Nama & Username</th>
                      <th className="px-5 py-3.5 whitespace-nowrap">Peran</th>
                      <th className="px-5 py-3.5 whitespace-nowrap">Kata Sandi</th>
                      <th className="px-5 py-3.5 whitespace-nowrap">Status</th>
                      <th className="px-5 py-3.5 whitespace-nowrap">Total Asesmen</th>
                      <th className="px-5 py-3.5 whitespace-nowrap text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {filteredUsers.map((u) => {
                      const roleConfig = ROLE_LABELS[u.accountType] ?? ROLE_LABELS.therapist;
                      const isActionLoading = actionLoadingId === u.id;
                      const isCurrentUser = u.id === session?.user.id || u.email.toLowerCase() === activeAdminEmail;
                      const passVisible = showPasswords[u.id] ?? false;
                      const displayPass = u.password || (u.accountType === "admin" ? "Poltekkes@Admin2026" : "Terapis@Flunify2026");

                      return (
                        <tr key={u.id} className="transition hover:bg-brand-light/30">
                          {/* Nama & Username (Email dihilangkan agar layout bersih & ringkas) */}
                          <td className="px-5 py-3.5">
                            <div className="flex items-center gap-3">
                              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-light text-xs font-bold text-brand shadow-xs">
                                {initials(u.fullName)}
                              </span>
                              <div className="min-w-0">
                                <p className="font-bold text-navy truncate flex items-center gap-1.5">
                                  {u.fullName}
                                  {isCurrentUser && (
                                    <span className="text-[10px] bg-brand/10 text-brand font-bold px-1.5 py-0.5 rounded">
                                      Anda
                                    </span>
                                  )}
                                </p>
                                <p className="font-mono text-xs font-semibold text-brand mt-0.5">
                                  @{u.username || u.email.split("@")[0]}
                                </p>
                              </div>
                            </div>
                          </td>

                          {/* Peran Akun (whitespace-nowrap agar tidak turun baris) */}
                          <td className="px-5 py-3.5 whitespace-nowrap">
                            <Badge tone={roleConfig.tone} className="whitespace-nowrap font-semibold">
                              {roleConfig.label}
                            </Badge>
                          </td>

                          {/* Kredensial Kata Sandi */}
                          <td className="px-5 py-3.5 whitespace-nowrap">
                            <div className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-canvas/60 px-2.5 py-1">
                              <KeyRound className="h-3 w-3 text-muted" />
                              <span className="font-mono text-xs text-navy font-medium tracking-wider">
                                {passVisible ? displayPass : "••••••••"}
                              </span>
                              <button
                                type="button"
                                onClick={() => setShowPasswords((prev) => ({ ...prev, [u.id]: !passVisible }))}
                                className="ml-1 text-muted hover:text-navy transition"
                                title={passVisible ? "Sembunyikan kata sandi" : "Lihat kata sandi"}
                              >
                                {passVisible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleCopyPassword(u.id, displayPass)}
                                className="text-muted hover:text-navy transition"
                                title="Salin kata sandi"
                              >
                                {copiedId === u.id ? (
                                  <Check className="h-3.5 w-3.5 text-success" />
                                ) : (
                                  <Copy className="h-3.5 w-3.5" />
                                )}
                              </button>
                            </div>
                          </td>

                          {/* Status Akun */}
                          <td className="px-5 py-3.5 whitespace-nowrap">
                            {u.status === "active" ? (
                              <Badge tone="success" className="gap-1 font-semibold whitespace-nowrap">
                                <span className="h-1.5 w-1.5 rounded-full bg-success" /> Aktif
                              </Badge>
                            ) : (
                              <Badge tone="danger" className="gap-1 font-semibold whitespace-nowrap">
                                <span className="h-1.5 w-1.5 rounded-full bg-danger" /> Nonaktif
                              </Badge>
                            )}
                          </td>

                          {/* Total Asesmen (dalam 1 baris rapi) */}
                          <td className="px-5 py-3.5 whitespace-nowrap">
                            <span className="font-bold text-navy text-sm font-mono">{u.assessmentCount}</span>{" "}
                            <span className="text-muted text-xs">sesi</span>
                          </td>

                          {/* Aksi Administrator (ukuran proporsional seragam) */}
                          <td className="px-5 py-3.5 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1.5 justify-end">
                              {/* Tombol Edit / Reset Password */}
                              <button
                                id={`edit-user-${u.id}`}
                                type="button"
                                onClick={() => openEditModal(u)}
                                className="h-8 w-8 grid place-items-center rounded-lg border border-line bg-white text-muted hover:border-brand/40 hover:text-brand hover:bg-brand-light transition"
                                title="Ubah data & kata sandi"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>

                              {/* Tombol Toggle Status */}
                              <button
                                id={`toggle-status-${u.id}`}
                                type="button"
                                disabled={isActionLoading || isCurrentUser}
                                onClick={() => toggleStatus(u)}
                                className={cn(
                                  "h-8 px-2.5 inline-flex items-center gap-1.5 rounded-lg border text-xs font-semibold transition disabled:opacity-40",
                                  u.status === "active"
                                    ? "border-line bg-white text-muted hover:text-danger hover:border-danger/30 hover:bg-danger-light"
                                    : "border-success/30 bg-success-light text-success hover:bg-success hover:text-white"
                                )}
                                title={u.status === "active" ? "Klik untuk menonaktifkan akun" : "Klik untuk mengaktifkan akun"}
                              >
                                {isActionLoading ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : u.status === "active" ? (
                                  <>
                                    <UserX className="h-3.5 w-3.5" />
                                    <span>Nonaktifkan</span>
                                  </>
                                ) : (
                                  <>
                                    <UserCheck className="h-3.5 w-3.5" />
                                    <span>Aktifkan</span>
                                  </>
                                )}
                              </button>

                              {/* Tombol Hapus Akun */}
                              {!isCurrentUser && (
                                <button
                                  id={`delete-user-${u.id}`}
                                  type="button"
                                  onClick={() => setDeletingUser(u)}
                                  className="h-8 w-8 grid place-items-center rounded-lg border border-danger/20 bg-white text-danger hover:bg-danger-light transition"
                                  title="Hapus akun permanen"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      {/* ============================================================== */}
      {/* TAB 2: RIWAYAT LOGIN & AUDIT LOG                               */}
      {/* ============================================================== */}
      {activeTab === "logs" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard icon={History} label="Total Percobaan Login" value={logStats.total} tone="navy" delay={0} />
            <StatCard icon={CheckCircle2} label="Login Berhasil" value={logStats.success} tone="success" delay={50} />
            <StatCard icon={ShieldAlert} label="Percobaan Gagal" value={logStats.failed} tone="warning" delay={100} />
          </div>

          {/* Banner Kebijakan Retensi Penyimpanan (Otomatis Hapus > 30 Hari) */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 rounded-2xl border border-brand/20 bg-brand-light/40 p-4 text-xs">
            <div className="flex items-center gap-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-brand text-white shadow-xs">
                <ShieldCheck className="h-4 w-4" />
              </span>
              <div>
                <p className="font-bold text-navy text-sm">Kebijakan Retensi Otomatis (30 Hari)</p>
                <p className="text-muted">
                  Seluruh riwayat login pengunjung dan staf yang melewati <strong>1 bulan (30 hari)</strong> otomatis dibersihkan oleh sistem untuk menjaga privasi & menghemat kapasitas storage database.
                </p>
              </div>
            </div>
            <span className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-brand/30 bg-white px-3 py-1.5 font-semibold text-brand text-xs shadow-xs">
              <span className="h-2 w-2 rounded-full bg-success animate-pulse" />
              Auto-Purge 30 Hari Aktif
            </span>
          </div>

          <section className="card overflow-hidden">
            <div className="flex flex-col gap-3 border-b border-line p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <label className="relative block w-full sm:w-72">
                  <span className="sr-only">Cari riwayat login</span>
                  <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" />
                  <input
                    id="search-logs"
                    value={logSearch}
                    onChange={(e) => setLogSearch(e.target.value)}
                    placeholder="Cari username, IP, keterangan..."
                    className="input py-2 pl-9"
                  />
                </label>

                <select
                  id="filter-log-status"
                  value={logStatusFilter}
                  onChange={(e) => setLogStatusFilter(e.target.value)}
                  className="input w-auto py-2 pr-8 text-xs font-semibold"
                >
                  <option value="all">Semua Status</option>
                  <option value="success">Hanya Berhasil</option>
                  <option value="failed">Hanya Gagal</option>
                </select>
              </div>

              <p className="text-xs font-semibold text-muted">
                Menampilkan {filteredLogs.length} dari {logs?.length ?? 0} catatan
              </p>
            </div>

            {!logs ? (
              <div className="space-y-3 p-5">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-12" />
                ))}
              </div>
            ) : filteredLogs.length === 0 ? (
              <EmptyState
                icon={History}
                title="Riwayat login belum tersedia"
                description="Aktivitas login terapis dan admin dalam 30 hari terakhir akan otomatis tercatat di sini."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[700px] text-left text-sm">
                  <thead className="bg-canvas/70 text-xs font-bold tracking-wide text-muted uppercase border-b border-line">
                    <tr>
                      <th className="px-5 py-3.5 whitespace-nowrap">Waktu & Tanggal</th>
                      <th className="px-5 py-3.5 whitespace-nowrap">Username & Akun</th>
                      <th className="px-5 py-3.5 whitespace-nowrap">Peran</th>
                      <th className="px-5 py-3.5 whitespace-nowrap">Status</th>
                      <th className="px-5 py-3.5 whitespace-nowrap">IP Address / Jaringan</th>
                      <th className="px-5 py-3.5 whitespace-nowrap">Keterangan</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {filteredLogs.map((l) => (
                      <tr key={l.id} className="transition hover:bg-brand-light/30">
                        <td className="px-5 py-3.5 text-xs font-medium text-navy whitespace-nowrap">
                          {formatDate(l.timestamp)}
                        </td>
                        <td className="px-5 py-3.5 whitespace-nowrap">
                          <p className="font-mono text-xs font-bold text-navy">@{l.username}</p>
                          {l.fullName && <p className="text-xs text-muted">{l.fullName}</p>}
                        </td>
                        <td className="px-5 py-3.5 whitespace-nowrap">
                          <Badge tone={l.role === "admin" ? "warning" : "brand"} className="whitespace-nowrap font-semibold">
                            {l.role === "admin" ? "Administrator" : "Terapis Wicara"}
                          </Badge>
                        </td>
                        <td className="px-5 py-3.5 whitespace-nowrap">
                          {l.status === "success" ? (
                            <Badge tone="success" className="whitespace-nowrap font-semibold">
                              <CheckCircle2 className="h-3 w-3" /> Berhasil
                            </Badge>
                          ) : (
                            <Badge tone="danger" className="whitespace-nowrap font-semibold">
                              <AlertCircle className="h-3 w-3" /> Gagal
                            </Badge>
                          )}
                        </td>
                        <td className="px-5 py-3.5 font-mono text-xs text-muted whitespace-nowrap">{l.ipAddress}</td>
                        <td className="px-5 py-3.5 text-xs text-muted">{l.message || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL 1: TAMBAH PENGGUNA BARU                                  */}
      {/* ============================================================== */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy/40 backdrop-blur-sm animate-fade-up">
          <div className="card w-full max-w-lg p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-4 border-b border-line">
              <div className="flex items-center gap-2.5">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-light text-brand">
                  <UserPlus className="h-5 w-5" />
                </span>
                <div>
                  <h3 className="font-bold text-navy text-lg">Tambah Akun Terapis / Pengguna</h3>
                  <p className="text-xs text-muted">Buat kredensial login baru untuk terapis wicara atau staf.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-canvas"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleAddUser} className="space-y-4 pt-4">
              {addError && (
                <div className="rounded-xl border border-danger/20 bg-danger-light p-3 text-xs font-semibold text-danger">
                  {addError}
                </div>
              )}

              <div>
                <label className="label">Nama Lengkap & Gelar</label>
                <input
                  type="text"
                  required
                  placeholder="Masukkan nama lengkap & gelar"
                  value={addFullName}
                  onChange={(e) => setAddFullName(e.target.value)}
                  className="input"
                />
              </div>

              <div>
                <label className="label">Username Login</label>
                <div className="relative">
                  <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 font-mono text-xs font-bold text-muted">
                    @
                  </span>
                  <input
                    type="text"
                    required
                    placeholder="Masukkan username"
                    value={addUsername}
                    onChange={(e) => setAddUsername(e.target.value.toLowerCase().replace(/\s+/g, "."))}
                    className="input pl-7 font-mono text-xs font-semibold"
                  />
                </div>
                <p className="mt-1 text-[11px] text-muted">Digunakan sebagai identitas saat login ke portal.</p>
              </div>

              {/* Kata Sandi Awal (Dedicated Card Block, Full Width) */}
              <div className="rounded-xl border border-line bg-canvas/50 p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="label mb-0 text-navy font-bold flex items-center gap-1.5">
                    <KeyRound className="h-3.5 w-3.5 text-brand" />
                    Kata Sandi Awal
                  </label>
                  {addPassword.length > 0 && (
                    <span className={cn("text-[11px] font-bold px-2 py-0.5 rounded-md", addPassword.length >= 8 ? "bg-success-light text-success" : "bg-warning-light text-warning")}>
                      {addPassword.length >= 8 ? "✓ Memenuhi syarat (8+ karakter)" : `${addPassword.length}/8 karakter`}
                    </span>
                  )}
                </div>

                <div className="relative">
                  <KeyRound className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 h-3.5 w-3.5 text-muted" />
                  <input
                    type="text"
                    required
                    minLength={8}
                    placeholder="Minimal 8 karakter"
                    value={addPassword}
                    onChange={(e) => setAddPassword(e.target.value)}
                    className={cn(
                      "input pl-8 font-mono text-xs bg-white",
                      addPassword.length > 0 && addPassword.length < 8 && "border-warning focus:border-warning"
                    )}
                  />
                </div>

                <p className="text-[11px] text-muted leading-relaxed">
                  Ketentuan: Kata sandi akun wajib minimal <strong>8 karakter</strong> demi keamanan sistem.
                </p>
              </div>

              <div>
                <label className="label">Peran Pengguna</label>
                <div className="grid grid-cols-2 gap-2">
                  {(["therapist", "admin"] as AccountType[]).map((type) => {
                    const active = addAccountType === type;
                    const meta = ROLE_LABELS[type];
                    return (
                      <button
                        key={type}
                        type="button"
                        onClick={() => setAddAccountType(type)}
                        className={cn(
                          "flex flex-col items-center justify-center rounded-xl p-2.5 border text-center transition-all",
                          active
                            ? "border-brand bg-brand-light text-brand font-bold"
                            : "border-line text-muted hover:bg-canvas"
                        )}
                      >
                        <meta.icon className="h-4 w-4 mb-1" />
                        <span className="text-xs">{meta.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-4 border-t border-line">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="btn border border-line bg-white hover:bg-canvas text-xs py-2 px-4"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={submittingAdd}
                  className="btn-primary text-xs py-2 px-4"
                >
                  {submittingAdd ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                  Simpan Akun Baru
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL 2: UBAH DATA & RESET PASSWORD PENGGUNA                   */}
      {/* ============================================================== */}
      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy/40 backdrop-blur-sm animate-fade-up">
          <div className="card w-full max-w-lg p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-4 border-b border-line">
              <div className="flex items-center gap-2.5">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-light text-brand">
                  <UserCog className="h-5 w-5" />
                </span>
                <div>
                  <h3 className="font-bold text-navy text-lg">Ubah Data & Kredensial</h3>
                  <p className="text-xs text-muted">Sesuaikan username, kata sandi, peran, dan status akun.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditingUser(null)}
                className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-canvas"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="space-y-4 pt-4">
              {editError && (
                <div className="rounded-xl border border-danger/20 bg-danger-light p-3 text-xs font-semibold text-danger">
                  {editError}
                </div>
              )}

              <div>
                <label className="label">Nama Lengkap</label>
                <input
                  type="text"
                  required
                  placeholder="Masukkan nama lengkap & gelar"
                  value={editFullName}
                  onChange={(e) => setEditFullName(e.target.value)}
                  className="input"
                />
              </div>

              {/* Username & Peran (Baris 2 kolom simetris & seimbang) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="label">Username</label>
                  <div className="relative">
                    <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 font-mono text-xs font-bold text-muted">
                      @
                    </span>
                    <input
                      type="text"
                      required
                      placeholder="Masukkan username"
                      value={editUsername}
                      onChange={(e) => setEditUsername(e.target.value.toLowerCase().replace(/\s+/g, "."))}
                      className="input pl-7 font-mono text-xs font-semibold"
                    />
                  </div>
                </div>

                <div>
                  <label className="label">Peran Pengguna</label>
                  <select
                    value={editAccountType}
                    onChange={(e) => setEditAccountType(e.target.value as AccountType)}
                    className="input text-xs"
                  >
                    <option value="therapist">Terapis Wicara</option>
                    <option value="admin">Administrator</option>
                  </select>
                </div>
              </div>

              {/* Status Akun */}
              <div>
                <label className="label">Status Akun</label>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value as AccountStatus)}
                  className="input text-xs"
                >
                  <option value="active">Aktif (Dapat mengakses sistem)</option>
                  <option value="inactive">Nonaktif (Akses ditangguhkan)</option>
                </select>
              </div>

              {/* Ubah / Reset Kata Sandi (Full Width Card - Rapi, Lega, Proporsional) */}
              <div className="rounded-xl border border-line bg-canvas/50 p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="label mb-0 text-navy font-bold flex items-center gap-1.5">
                    <KeyRound className="h-3.5 w-3.5 text-brand" />
                    Ubah Kata Sandi (Opsional)
                  </label>
                  {editPassword.length > 0 && (
                    <span className={cn("text-[11px] font-bold px-2 py-0.5 rounded-md", editPassword.length >= 8 ? "bg-success-light text-success" : "bg-warning-light text-warning")}>
                      {editPassword.length >= 8 ? "✓ Memenuhi syarat (8+ karakter)" : `${editPassword.length}/8 karakter`}
                    </span>
                  )}
                </div>

                <div className="relative">
                  <KeyRound className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 h-3.5 w-3.5 text-muted" />
                  <input
                    type="text"
                    minLength={8}
                    placeholder="Masukkan sandi baru (opsional)"
                    value={editPassword}
                    onChange={(e) => setEditPassword(e.target.value)}
                    className={cn(
                      "input pl-8 font-mono text-xs bg-white",
                      editPassword.length > 0 && editPassword.length < 8 && "border-warning focus:border-warning"
                    )}
                  />
                </div>

                <p className="text-[11px] text-muted leading-relaxed">
                  Ketentuan: Minimal <strong>8 karakter</strong>. Biarkan kosong jika tidak ingin mengubah kata sandi lama akun ini.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-4 border-t border-line">
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  className="btn border border-line bg-white hover:bg-canvas text-xs py-2 px-4"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={submittingEdit}
                  className="btn-primary text-xs py-2 px-4"
                >
                  {submittingEdit ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Simpan Perubahan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL 3: KONFIRMASI HAPUS PENGGUNA                             */}
      {/* ============================================================== */}
      {deletingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy/40 backdrop-blur-sm animate-fade-up">
          <div className="card w-full max-w-md p-6 shadow-2xl">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-danger-light text-danger">
                <Trash2 className="h-5 w-5" />
              </span>
              <div>
                <h3 className="font-bold text-navy text-lg">Konfirmasi Hapus Akun</h3>
                <p className="mt-1 text-xs text-muted leading-relaxed">
                  Apakah Anda yakin ingin menghapus akun{" "}
                  <strong className="text-navy font-semibold">{deletingUser.fullName}</strong> (
                  <span className="font-mono text-brand font-bold">@{deletingUser.username || deletingUser.email}</span>
                  )? Pengguna ini tidak akan dapat login lagi ke sistem Flunify.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 mt-6 pt-4 border-t border-line">
              <button
                type="button"
                onClick={() => setDeletingUser(null)}
                className="btn border border-line bg-white hover:bg-canvas text-xs py-2 px-4"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={submittingDelete}
                onClick={handleDeleteUser}
                className="btn bg-danger text-white hover:bg-danger/90 text-xs py-2 px-4 font-bold"
              >
                {submittingDelete ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Hapus Akun
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
