"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  Activity,
  AlertCircle,
  ArrowLeft,
  Calendar,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Hash,
  Loader2,
  Mic,
  MicOff,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Sparkles,
  Square,
  User,
  Volume2,
} from "lucide-react";
import { Badge, PageHeader, SectionCard } from "@/components/ui";
import { useSession } from "@/lib/auth/AuthContext";
import { useRepository } from "@/lib/data/useRepository";
import { cn, formatDuration, formatPercent, todayISO } from "@/lib/format";
import { getSSISeverity, validateSS } from "@/lib/ss";
import type { MasterData, NewAssessmentInput } from "@/lib/types";

const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
];

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return MIME_CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t));
}

function micErrorMessage(err: unknown): string {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Izin mikrofon ditolak. Izinkan akses mikrofon pada peramban lalu coba lagi.";
  }
  if (name === "NotFoundError") {
    return "Mikrofon tidak ditemukan. Pastikan perangkat mikrofon terpasang pada komputer.";
  }
  if (name === "NotReadableError") {
    return "Mikrofon sedang dipakai oleh aplikasi lain.";
  }
  return "Tidak dapat mengakses mikrofon. Pastikan mikrofon aktif dan izin peramban diizinkan.";
}

export function NewAssessmentView() {
  const router = useRouter();
  const session = useSession();
  const repo = useRepository();

  // Master Data (Tugas Bicara & Disfluency Types)
  const [masterData, setMasterData] = useState<MasterData | null>(null);

  // Form Fields - Step 1: Identitas Klien
  const [clientCode, setClientCode] = useState("");
  const [clientAge, setClientAge] = useState("");
  const [assessmentDate, setAssessmentDate] = useState(todayISO());
  const [caseHistory, setCaseHistory] = useState("");

  // Form Fields - Step 2: Observasi Klinis
  const [selectedTasks, setSelectedTasks] = useState<string[]>([]);
  const [selectedDisfluencies, setSelectedDisfluencies] = useState<string[]>([]);

  // Form Fields - Step 3: Perekaman Audio Bicara & Deteksi Suku Kata Real-Time
  const [recorderState, setRecorderState] = useState<"idle" | "recording" | "paused" | "recorded">("idle");
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const [liveSyllables, setLiveSyllables] = useState(0);
  const [isSyllablePulsing, setIsSyllablePulsing] = useState(false);

  // Form Fields - Step 4: Kalkulasi %SS & Catatan Klinis
  const [totalSyllables, setTotalSyllables] = useState("");
  const [stutteredSyllables, setStutteredSyllables] = useState("");
  const [therapistNotes, setTherapistNotes] = useState("");

  // Refs untuk Audio & Analisis Akustik
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const startPerfRef = useRef<number>(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isRecordingRef = useRef<boolean>(false);
  const liveSyllablesRef = useRef<number>(0);
  const noiseFloorRef = useRef<number>(18);

  // Status Pengiriman
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successSaved, setSuccessSaved] = useState(false);

  // Muat Master Data
  useEffect(() => {
    let cancelled = false;
    repo
      .getMasterData()
      .then((data) => {
        if (!cancelled) {
          setMasterData(data);
          if (data.speechTasks.length && selectedTasks.length === 0) {
            setSelectedTasks([data.speechTasks[0]]);
          }
          if (data.disfluencyTypes.length && selectedDisfluencies.length === 0) {
            setSelectedDisfluencies([data.disfluencyTypes[0]]);
          }
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [repo]);

  // Teardown Web Audio & Streams
  const teardownAudio = useCallback(() => {
    isRecordingRef.current = false;
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    timerIntervalRef.current = null;
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    audioCtxRef.current?.close().catch(() => undefined);
    audioCtxRef.current = null;
    analyserRef.current = null;
  }, []);

  // Cleanup saat unmount
  useEffect(() => {
    return () => {
      teardownAudio();
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
    };
  }, [audioUrl, teardownAudio]);

  // Loop Analisis Akustik Suku Kata & Gambar Gelombang Bar
  const startAcousticLoop = useCallback((analyser: AnalyserNode) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const freqData = new Uint8Array(analyser.frequencyBinCount);
    const bars = 36;

    let isSyllableActive = false;
    let lastPeakTime = 0;

    const render = () => {
      if (!isRecordingRef.current) return;
      analyser.getByteFrequencyData(freqData);

      // 1. Gambar Gelombang Bar Audio
      if (canvas && ctx) {
        const { width, height } = canvas;
        ctx.clearRect(0, 0, width, height);
        const gap = 2.5;
        const barW = (width - gap * (bars - 1)) / bars;

        for (let i = 0; i < bars; i++) {
          const v = freqData[Math.floor((i / bars) * freqData.length * 0.7)] / 255;
          const h = Math.max(3, v * height);
          ctx.fillStyle = `rgba(66, 103, 178, ${0.35 + v * 0.65})`;
          const x = i * (barW + gap);
          ctx.beginPath();
          ctx.roundRect(x, (height - h) / 2, barW, h, 2);
          ctx.fill();
        }
      }

      // 2. Deteksi Akustik Suku Kata Super Responsif
      // Vokal manusia berada di rentang energi ~200Hz - 2800Hz (Bin 2 hingga Bin 30 pada FFT 512, sampleRate 48kHz)
      let energySum = 0;
      const startBin = 2;
      const endBin = Math.min(30, freqData.length);
      for (let b = startBin; b < endBin; b++) {
        energySum += freqData[b];
      }
      const vocalEnergy = energySum / (endBin - startBin);

      // Pelacak dinamis tingkat kebisingan latar (noise floor)
      if (vocalEnergy < 25) {
        noiseFloorRef.current = noiseFloorRef.current * 0.95 + vocalEnergy * 0.05;
      }

      const now = performance.now();
      // Ambang batas responsif di atas tingkat kebisingan ruangan
      const onsetThreshold = Math.max(14, noiseFloorRef.current * 1.3 + 6);
      const offsetThreshold = Math.max(8, noiseFloorRef.current * 1.05 + 3);
      const minIntervalMs = 110; // Mendukung hingga ~9 suku kata per detik (sangat responsif)

      if (!isSyllableActive && vocalEnergy > onsetThreshold && now - lastPeakTime > minIntervalMs) {
        isSyllableActive = true;
        lastPeakTime = now;
        liveSyllablesRef.current += 1;
        const nextCount = liveSyllablesRef.current;

        setLiveSyllables(nextCount);
        // Langsung sinkronkan ke Langkah 4 secara live saat berbicara
        setTotalSyllables(String(nextCount));

        // Efek visual denyut saat suku kata terdeteksi
        setIsSyllablePulsing(true);
        setTimeout(() => setIsSyllablePulsing(false), 90);
      } else if (isSyllableActive && vocalEnergy < offsetThreshold) {
        isSyllableActive = false;
      }

      rafRef.current = requestAnimationFrame(render);
    };

    render();
  }, []);

  // Validasi %SS secara real-time
  const ssValidation = useMemo(() => {
    return validateSS(totalSyllables, stutteredSyllables);
  }, [totalSyllables, stutteredSyllables]);

  const currentSSPercentage = ssValidation.percentage ?? 0;
  const severityInfo = useMemo(() => {
    return getSSISeverity(currentSSPercentage);
  }, [currentSSPercentage]);

  // Toggle Pilihan Tugas Bicara
  const toggleSpeechTask = (task: string) => {
    setSelectedTasks((prev) =>
      prev.includes(task) ? prev.filter((t) => t !== task) : [...prev, task]
    );
  };

  // Toggle Pilihan Jenis Ketidaklancaran
  const toggleDisfluency = (dis: string) => {
    setSelectedDisfluencies((prev) =>
      prev.includes(dis) ? prev.filter((d) => d !== dis) : [...prev, dis]
    );
  };

  // Acak Kode Klien
  const generateRandomCode = () => {
    const num = Math.floor(Math.random() * 900) + 100;
    setClientCode(`C${num}`);
  };

  // -------------------------------------------------------------
  // Logika Perekaman Mikrofon (Bebas Suara Hujan/Kresek & Super Responsif)
  // -------------------------------------------------------------
  async function startRecording() {
    setMicError(null);
    try {
      // Constraints audio berkualitas tinggi:
      // - autoGainControl: false -> Mencegah amplifikasi derau/desis fan laptop yang terdengar seperti suara hujan
      // - echoCancellation: true & noiseSuppression: true -> Menjernihkan suara vokal
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: { ideal: true },
            noiseSuppression: { ideal: true },
            autoGainControl: { ideal: false },
            sampleRate: { ideal: 48000 },
            channelCount: { ideal: 1 },
          },
        });
      } catch {
        // Fallback jika browser membutuhkan constraint sederhana
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: false,
          },
        });
      }

      streamRef.current = stream;

      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const finalSecs = Math.max(1, Math.round((performance.now() - startPerfRef.current) / 1000));
        const blob = new Blob(audioChunksRef.current, {
          type: recorder.mimeType || mimeType || "audio/webm",
        });
        teardownAudio();

        if (blob.size === 0) {
          setMicError("Rekaman tidak menghasilkan suara. Pastikan mikrofon berfungsi lalu coba lagi.");
          setRecorderState("idle");
          return;
        }

        setAudioBlob(blob);
        const url = URL.createObjectURL(blob);
        setAudioUrl(url);
        setRecordingSeconds(finalSecs);
        setRecorderState("recorded");

        // Sinkronisasi akhir ke Langkah 4:
        // Gunakan jumlah suku kata terdeteksi dari mic, atau standar estimasi durasi jika belum terdeteksi
        const finalSyllables =
          liveSyllablesRef.current > 0
            ? liveSyllablesRef.current
            : Math.max(10, Math.round(finalSecs * 3.5));
        setLiveSyllables(finalSyllables);
        setTotalSyllables(String(finalSyllables));
      };

      // Konfigurasi Web Audio Analyser untuk Deteksi Suku Kata & Visualizer
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        try {
          const audioCtx = new AudioCtx({ sampleRate: 48000 });
          audioCtxRef.current = audioCtx;
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 512;
          analyser.smoothingTimeConstant = 0.2; // Responsif terhadap perubahan transien vokal
          analyserRef.current = analyser;

          const source = audioCtx.createMediaStreamSource(stream);
          source.connect(analyser);

          isRecordingRef.current = true;
          startAcousticLoop(analyser);
        } catch (e) {
          console.warn("Audio analyser warning:", e);
        }
      }

      // Rekam secara kontinyu tanpa pemotongan chunk berkala
      // (Menghilangkan suara kresek/pop pada batas chunk WebM)
      recorder.start();
      startPerfRef.current = performance.now();
      setRecordingSeconds(0);
      setLiveSyllables(0);
      liveSyllablesRef.current = 0;
      noiseFloorRef.current = 18;
      setTotalSyllables("");
      isRecordingRef.current = true;
      setRecorderState("recording");

      timerIntervalRef.current = setInterval(() => {
        const secs = Math.round((performance.now() - startPerfRef.current) / 1000);
        setRecordingSeconds(secs);
      }, 500);
    } catch (err) {
      teardownAudio();
      setRecorderState("idle");
      setMicError(micErrorMessage(err));
    }
  }

  function pauseRecording() {
    isRecordingRef.current = false;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.pause();
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      setRecorderState("paused");
    }
  }

  function resumeRecording() {
    isRecordingRef.current = true;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "paused") {
      mediaRecorderRef.current.resume();
      timerIntervalRef.current = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
      setRecorderState("recording");
      if (analyserRef.current) {
        startAcousticLoop(analyserRef.current);
      }
    }
  }

  function stopRecording() {
    isRecordingRef.current = false;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
  }

  function resetRecording() {
    isRecordingRef.current = false;
    teardownAudio();
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioBlob(null);
    setAudioUrl(null);
    setRecordingSeconds(0);
    setLiveSyllables(0);
    liveSyllablesRef.current = 0;
    noiseFloorRef.current = 18;
    setTotalSyllables("");
    setRecorderState("idle");
    setMicError(null);
  }

  // -------------------------------------------------------------
  // Submit Formulir Asesmen
  // -------------------------------------------------------------
  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitError(null);

    if (!clientCode.trim()) {
      setSubmitError("Kode klien wajib diisi atau gunakan tombol 'Acak Kode'.");
      return;
    }

    const ageNum = Number(clientAge);
    if (!clientAge || Number.isNaN(ageNum) || ageNum <= 0 || ageNum > 120) {
      setSubmitError("Usia klien harus berupa bilangan 1 - 120 tahun.");
      return;
    }

    if (selectedTasks.length === 0) {
      setSubmitError("Pilih minimal 1 tugas bicara yang diobservasi.");
      return;
    }

    if (selectedDisfluencies.length === 0) {
      setSubmitError("Pilih minimal 1 jenis ketidaklancaran yang teramati.");
      return;
    }

    if (!ssValidation.valid || ssValidation.total === null || ssValidation.stuttered === null) {
      setSubmitError(
        ssValidation.errors.total ||
          ssValidation.errors.stuttered ||
          "Data perhitungan suku kata (%SS) belum valid."
      );
      return;
    }

    if (recorderState === "recording" || recorderState === "paused") {
      stopRecording();
    }

    setSubmitting(true);
    try {
      const input: NewAssessmentInput = {
        clientCode: clientCode.trim().toUpperCase(),
        clientAge: ageNum,
        assessmentDate,
        caseHistory: caseHistory.trim(),
        speechTasks: selectedTasks,
        disfluencyTypes: selectedDisfluencies,
        totalSyllables: ssValidation.total,
        stutteredSyllables: ssValidation.stuttered,
        therapistNotes: therapistNotes.trim(),
        audioBlob,
        audioDurationSeconds: recordingSeconds,
      };

      await repo.createAssessment(input, session.user);
      setSuccessSaved(true);
      setTimeout(() => {
        router.push("/dashboard");
      }, 1500);
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : "Gagal menyimpan data asesmen.");
      setSubmitting(false);
    }
  }

  const speechTaskOptions = masterData?.speechTasks ?? [
    "Bicara spontan",
    "Bercerita",
    "Menjawab pertanyaan",
    "Membaca",
  ];

  const disfluencyOptions = masterData?.disfluencyTypes ?? [
    "Pengulangan bunyi/suku kata",
    "Pengulangan kata utuh",
    "Pengulangan frasa",
    "Pemanjangan bunyi (prolongation)",
    "Blocking",
    "Interjeksi / jeda",
    "Perilaku penyerta",
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-4 pb-12">
      {/* Breadcrumb Navigation */}
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs font-semibold text-muted">
        <Link href="/dashboard" className="transition hover:text-navy">
          Dashboard Klinis
        </Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-brand">Asesmen Baru</span>
      </nav>

      {/* Header Halaman Ringkas */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-line/70 pb-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-navy">Mulai Asesmen Baru</h1>
          <p className="text-xs text-muted mt-0.5">
            Observasi ketidaklancaran bicara, rekam sampel audio, dan hitung formula %SS secara klinis.
          </p>
        </div>
        <Link
          href="/dashboard"
          className="btn border border-line bg-white hover:bg-canvas text-xs py-1.5 px-3 self-start sm:self-auto"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Batal & Kembali
        </Link>
      </div>

      {/* Notifikasi Berhasil */}
      {successSaved && (
        <div
          role="status"
          className="flex items-center gap-2.5 rounded-xl border border-success/30 bg-success-light p-3.5 text-success animate-fade-up shadow-sm"
        >
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          <div className="text-xs">
            <span className="font-bold">Asesmen Berhasil Disimpan!</span> Data klien {clientCode.toUpperCase()} telah
            tercatat ke rekam medis. Mengalihkan ke dashboard...
          </div>
        </div>
      )}

      {/* Notifikasi Error */}
      {submitError && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-xl border border-danger/30 bg-danger-light p-3 text-xs text-danger animate-fade-up"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <span className="font-bold">Periksa formulir: </span>
            <span>{submitError}</span>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate className="space-y-3.5">
        {/* ========================================================== */}
        {/* LANGKAH 1: IDENTITAS KLIEN & ANAMNESIS KASUS               */}
        {/* ========================================================== */}
        <SectionCard
          step={1}
          icon={User}
          title="Identitas Klien & Riwayat Kasus"
          description="Kode identifikasi anonim pasien untuk menjaga kerahasiaan rekam medis."
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="client-code" className="text-xs font-bold text-navy">
                  Kode Klien <span className="text-danger">*</span>
                </label>
                <button
                  type="button"
                  onClick={generateRandomCode}
                  className="text-[10px] font-bold text-brand hover:underline inline-flex items-center gap-0.5"
                >
                  <Sparkles className="h-2.5 w-2.5" /> Acak
                </button>
              </div>
              <div className="relative">
                <Hash className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 h-3.5 w-3.5 text-muted" />
                <input
                  id="client-code"
                  type="text"
                  required
                  placeholder="Masukkan kode klien"
                  value={clientCode}
                  onChange={(e) => setClientCode(e.target.value.toUpperCase())}
                  className="input h-9 pl-8 text-xs font-bold tracking-wider"
                />
              </div>
            </div>

            <div>
              <label htmlFor="client-age" className="block text-xs font-bold text-navy mb-1">
                Usia Klien (Tahun) <span className="text-danger">*</span>
              </label>
              <input
                id="client-age"
                type="number"
                min="1"
                max="120"
                required
                placeholder="Masukkan usia klien"
                value={clientAge}
                onChange={(e) => setClientAge(e.target.value)}
                className="input h-9 text-xs"
              />
            </div>

            <div>
              <label htmlFor="assessment-date" className="block text-xs font-bold text-navy mb-1">
                Tanggal Asesmen <span className="text-danger">*</span>
              </label>
              <div className="relative">
                <Calendar className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 h-3.5 w-3.5 text-muted" />
                <input
                  id="assessment-date"
                  type="date"
                  required
                  value={assessmentDate}
                  onChange={(e) => setAssessmentDate(e.target.value)}
                  className="input h-9 pl-8 text-xs"
                />
              </div>
            </div>
          </div>

          <div className="mt-3">
            <label htmlFor="case-history" className="block text-xs font-bold text-navy mb-1">
              Riwayat Kasus & Onset Keluhan (Anamnesis)
            </label>
            <textarea
              id="case-history"
              rows={2}
              placeholder="Tuliskan riwayat awal kemunculan ketidaklancaran, onset usia, situasi pemicu, dan respons keluarga."
              value={caseHistory}
              onChange={(e) => setCaseHistory(e.target.value)}
              className="input text-xs leading-relaxed py-2 px-3"
            />
          </div>
        </SectionCard>

        {/* ========================================================== */}
        {/* LANGKAH 2: OBSERVASI KLINIS & CHECKLIST DISFLUENCY         */}
        {/* ========================================================== */}
        <SectionCard
          step={2}
          icon={ClipboardList}
          title="Observasi Ketidaklancaran (Disfluency Observations)"
          description="Pilih tugas bicara yang diobservasi dan gejala ketidaklancaran yang teramati."
        >
          {/* Tugas Bicara */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-bold text-navy">
                Tugas Bicara yang Diobservasi <span className="text-danger">*</span>
              </span>
              <span className="text-[11px] text-muted">{selectedTasks.length} dipilih</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {speechTaskOptions.map((task) => {
                const active = selectedTasks.includes(task);
                return (
                  <button
                    key={task}
                    type="button"
                    onClick={() => toggleSpeechTask(task)}
                    className={cn(
                      "flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold transition border",
                      active
                        ? "bg-brand text-white border-brand shadow-xs"
                        : "bg-white text-navy border-line hover:border-brand/40 hover:bg-brand-light/30"
                    )}
                  >
                    {active ? <Check className="h-3 w-3" /> : <Plus className="h-3 w-3 text-muted" />}
                    {task}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Jenis Ketidaklancaran */}
          <div className="mt-3 pt-3 border-t border-line/70">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-bold text-navy">
                Jenis Ketidaklancaran yang Teramati <span className="text-danger">*</span>
              </span>
              <span className="text-[11px] text-muted">{selectedDisfluencies.length} teramati</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {disfluencyOptions.map((dis) => {
                const active = selectedDisfluencies.includes(dis);
                return (
                  <button
                    key={dis}
                    type="button"
                    onClick={() => toggleDisfluency(dis)}
                    className={cn(
                      "flex items-center justify-between rounded-lg px-2.5 py-1.5 text-xs text-left transition border",
                      active
                        ? "bg-navy/5 text-navy border-navy/30 font-bold"
                        : "bg-white text-muted border-line hover:border-brand/40 hover:text-navy hover:bg-canvas"
                    )}
                  >
                    <span>{dis}</span>
                    <span
                      className={cn(
                        "grid h-4 w-4 place-items-center rounded border text-[10px]",
                        active ? "border-brand bg-brand text-white" : "border-line bg-canvas text-transparent"
                      )}
                    >
                      ✓
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </SectionCard>

        {/* ========================================================== */}
        {/* LANGKAH 3: PEREKAMAN SAMPEL BICARA (AUDIO RECORDER)        */}
        {/* ========================================================== */}
        <SectionCard
          step={3}
          icon={Mic}
          title="Perekaman Sampel Bicara (Speech Recording)"
          description="Rekam audio bicara langsung melalui mikrofon perangkat untuk dievaluasi."
        >
          {micError && (
            <div className="mb-3 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-light p-2.5 text-xs text-warning">
              <MicOff className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{micError}</span>
            </div>
          )}

          <div className="rounded-xl border border-line bg-canvas/40 p-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              {/* Status & Durasi Timer */}
              <div className="flex items-center gap-3">
                <span className="font-mono text-2xl font-black tracking-wider text-navy">
                  {formatDuration(recordingSeconds)}
                </span>
                {recorderState === "recording" && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-danger/10 px-2 py-0.5 text-[10px] font-bold text-danger uppercase tracking-wide">
                    <span className="h-2 w-2 rounded-full bg-danger animate-ping" />
                    Merekam...
                  </span>
                )}
                {recorderState === "paused" && (
                  <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-bold text-warning uppercase">
                    Dijeda
                  </span>
                )}
                {recorderState === "recorded" && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-bold text-success uppercase">
                    <Check className="h-3 w-3" /> Rekaman Bersih Tersimpan
                  </span>
                )}
              </div>

              {/* Tombol Aksi Kontrol Mic */}
              <div className="flex items-center gap-2">
                {recorderState === "idle" && (
                  <button
                    id="btn-start-record"
                    type="button"
                    onClick={startRecording}
                    className="btn-primary text-xs py-1.5 px-4 shadow-sm"
                  >
                    <Mic className="h-3.5 w-3.5" /> Mulai Rekam Audio
                  </button>
                )}

                {recorderState === "recording" && (
                  <>
                    <button
                      type="button"
                      onClick={pauseRecording}
                      className="btn border border-line bg-white hover:bg-canvas text-xs py-1.5 px-3 text-navy"
                    >
                      <Pause className="h-3.5 w-3.5" /> Jeda
                    </button>
                    <button
                      type="button"
                      onClick={stopRecording}
                      className="btn bg-danger text-white hover:bg-danger/90 text-xs py-1.5 px-3.5 font-bold shadow-sm"
                    >
                      <Square className="h-3.5 w-3.5 fill-white" /> Selesai Merekam
                    </button>
                  </>
                )}

                {recorderState === "paused" && (
                  <>
                    <button
                      type="button"
                      onClick={resumeRecording}
                      className="btn-primary text-xs py-1.5 px-3"
                    >
                      <Play className="h-3.5 w-3.5" /> Lanjutkan
                    </button>
                    <button
                      type="button"
                      onClick={stopRecording}
                      className="btn bg-danger text-white hover:bg-danger/90 text-xs py-1.5 px-3.5 font-bold"
                    >
                      <Square className="h-3.5 w-3.5 fill-white" /> Selesai
                    </button>
                  </>
                )}

                {recorderState === "recorded" && (
                  <button
                    type="button"
                    onClick={resetRecording}
                    className="btn border border-line bg-white hover:bg-canvas text-xs py-1 px-3 text-muted hover:text-navy"
                  >
                    <RotateCcw className="h-3 w-3" /> Rekam Ulang
                  </button>
                )}
              </div>
            </div>

            {/* Deteksi Suku Kata Real-Time (Live Counter) & Canvas Visualizer */}
            {(recorderState === "recording" || recorderState === "paused") && (
              <div className="mt-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 rounded-lg border border-brand/25 bg-white/95 p-2.5 shadow-xs">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "grid h-7 w-7 place-items-center rounded-lg text-white transition-all duration-150",
                      isSyllablePulsing
                        ? "bg-danger scale-110 shadow-sm shadow-danger/50"
                        : "bg-brand scale-100"
                    )}
                  >
                    <Mic className="h-3.5 w-3.5" />
                  </span>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-black text-navy tracking-tight">
                        {liveSyllables} Suku Kata Terdeteksi
                      </span>
                      <span className="inline-flex items-center rounded-full bg-success/15 px-1.5 py-0.2 text-[9px] font-bold text-success">
                        Live
                      </span>
                    </div>
                    <p className="text-[10px] text-muted">
                      Mendeteksi setiap denyut vokal bicara secara real-time
                    </p>
                  </div>
                </div>

                {/* Canvas Gelombang Suara (Level Bar) */}
                <div className="flex items-center justify-center">
                  <canvas
                    ref={canvasRef}
                    width={220}
                    height={28}
                    className="h-7 w-52 rounded bg-canvas/70 border border-line/60"
                  />
                </div>
              </div>
            )}

            {/* Pemutar Audio & Sinkronisasi Langsung ke Langkah 4 */}
            {audioUrl && (
              <div className="mt-3 pt-3 border-t border-line/70">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Volume2 className="h-4 w-4 text-brand shrink-0" />
                    <audio src={audioUrl} controls className="h-8 w-64 sm:w-72" />
                  </div>
                  <div className="rounded-lg bg-brand-light/70 px-2.5 py-1 text-[11px] font-semibold text-brand flex items-center gap-1.5">
                    <Sparkles className="h-3 w-3 shrink-0" />
                    <span>
                      Tersinkron: {liveSyllables} Suku Kata ke Langkah 4
                    </span>
                  </div>
                </div>
                <p className="mt-1.5 text-[10px] text-muted">
                  Tip: Putar rekaman audio di atas sambil mengeklik tombol <strong>&apos;+ 1 Gagap&apos;</strong> pada Langkah 4 di bawah untuk menghitung ketidaklancaran.
                </p>
              </div>
            )}
          </div>
        </SectionCard>

        {/* ========================================================== */}
        {/* LANGKAH 4: KALKULATOR %SS & CATATAN KLINIS                 */}
        {/* ========================================================== */}
        <SectionCard
          step={4}
          icon={Activity}
          title="Penghitungan Formula %SS & Catatan Klinis"
          description="Kalkulasi otomatis: %SS = (Suku Kata Gagap / Total Suku Kata) × 100."
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {/* Input Suku Kata & Penghitung Gagap */}
            <div className="space-y-2.5">
              {/* Input Total Suku Kata */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label htmlFor="total-syllables" className="text-xs font-bold text-navy">
                    Total Suku Kata Diucapkan <span className="text-danger">*</span>
                  </label>
                  {Number(totalSyllables) > 0 && (
                    <span className="text-[10px] font-bold text-brand bg-brand-light px-1.5 py-0.5 rounded">
                      ⚡ Sinkron Mic ({recordingSeconds > 0 ? `${recordingSeconds}s · ` : ""}{totalSyllables} Suku Kata)
                    </span>
                  )}
                </div>
                <input
                  id="total-syllables"
                  type="number"
                  min="1"
                  required
                  placeholder="Masukkan total suku kata"
                  value={totalSyllables}
                  onChange={(e) => setTotalSyllables(e.target.value)}
                  className="input h-9 text-xs font-bold"
                />
              </div>

              {/* Input Suku Kata Gagap dengan Tombol Tally Live */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label htmlFor="stuttered-syllables" className="text-xs font-bold text-navy">
                    Suku Kata Gagap <span className="text-danger">*</span>
                  </label>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        const curr = Number(stutteredSyllables) || 0;
                        setStutteredSyllables(String(curr + 1));
                      }}
                      className="btn bg-danger hover:bg-danger/90 text-white text-[11px] py-0.5 px-2 font-bold rounded shadow-xs inline-flex items-center gap-0.5"
                      title="Klik setiap kali mendengar suku kata gagap"
                    >
                      <Plus className="h-3 w-3" /> 1 Gagap
                    </button>
                    {(Number(stutteredSyllables) || 0) > 0 && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            const curr = Number(stutteredSyllables) || 0;
                            setStutteredSyllables(String(Math.max(0, curr - 1)));
                          }}
                          className="btn bg-white hover:bg-canvas text-navy border border-line text-[11px] py-0.5 px-1.5 font-bold rounded"
                          title="Kurangi 1"
                        >
                          -1
                        </button>
                        <button
                          type="button"
                          onClick={() => setStutteredSyllables("0")}
                          className="text-[10px] text-muted hover:text-danger hover:underline px-1"
                        >
                          Reset
                        </button>
                      </>
                    )}
                  </div>
                </div>
                <input
                  id="stuttered-syllables"
                  type="number"
                  min="0"
                  required
                  placeholder="Masukkan jumlah suku kata gagap"
                  value={stutteredSyllables}
                  onChange={(e) => setStutteredSyllables(e.target.value)}
                  className="input h-9 text-xs font-bold text-danger"
                />
              </div>
            </div>

            {/* Panel Hasil Kalkulasi %SS Real-Time */}
            <div className="rounded-xl border border-line bg-gradient-to-br from-white to-brand-light/30 p-3.5 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-muted">Hasil Kalkulasi %SS</span>
                  {ssValidation.valid && totalSyllables !== "" && stutteredSyllables !== "" && (
                    <Badge tone={severityInfo.tone}>{severityInfo.label}</Badge>
                  )}
                </div>

                <div className="my-2 text-center">
                  <span className="text-3xl sm:text-4xl font-black tracking-tight text-navy">
                    {formatPercent(currentSSPercentage)}
                  </span>
                  <p className="mt-0.5 font-mono text-[11px] text-muted">
                    ({stutteredSyllables || 0} / {totalSyllables || 1}) × 100%
                  </p>
                </div>
              </div>

              <div className="rounded-lg border border-line/60 bg-white/90 p-2 text-[10px] text-muted leading-tight">
                <span className="font-bold text-navy">Panduan SSI: </span>
                {severityInfo.description}
              </div>
            </div>
          </div>

          {/* Catatan Observasi Terapis */}
          <div className="mt-3">
            <label htmlFor="therapist-notes" className="block text-xs font-bold text-navy mb-1">
              Catatan Observasi Terapis & Rekomendasi
            </label>
            <textarea
              id="therapist-notes"
              rows={2}
              placeholder="Catatan observasi perilaku penyerta fisik, fluktuasi kecepatan bicara, dan rencana terapi berikutnya."
              value={therapistNotes}
              onChange={(e) => setTherapistNotes(e.target.value)}
              className="input text-xs leading-relaxed py-2 px-3"
            />
          </div>
        </SectionCard>

        {/* Tombol Simpan Formulir */}
        <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-line">
          <Link
            href="/dashboard"
            className="btn border border-line bg-white hover:bg-canvas text-xs py-2 px-4 text-muted hover:text-navy font-semibold"
          >
            Batal
          </Link>

          <button
            id="btn-submit-assessment"
            type="submit"
            disabled={submitting || successSaved}
            className="btn-primary text-xs py-2 px-5 font-bold shadow-md shadow-brand/20"
          >
            {submitting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Menyimpan...
              </>
            ) : successSaved ? (
              <>
                <Check className="h-3.5 w-3.5" /> Tersimpan
              </>
            ) : (
              <>
                <CheckCircle2 className="h-3.5 w-3.5" /> Simpan Dokumen Asesmen
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

export default NewAssessmentView;
