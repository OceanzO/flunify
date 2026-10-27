export const MAX_SYLLABLES = 100_000;
const INTEGER = /^\d+$/;

export interface SSResult {
  valid: boolean;
  total: number | null;
  stuttered: number | null;
  percentage: number | null;
  errors: { total?: string; stuttered?: string };
}

/** %SS = (suku kata gagap / total suku kata) × 100, dibulatkan 2 desimal. */
export function computeSS(stuttered: number, total: number): number {
  return Math.round((stuttered / total) * 10_000) / 100;
}

/**
 * Validasi ketat input %SS dari string mentah form.
 * - total: bilangan bulat > 0 (mencegah pembagian dengan nol)
 * - stuttered: bilangan bulat ≥ 0 dan ≤ total
 */
export function validateSS(totalRaw: string, stutteredRaw: string): SSResult {
  const errors: SSResult["errors"] = {};
  const t = totalRaw.trim();
  const s = stutteredRaw.trim();
  let total: number | null = null;
  let stuttered: number | null = null;

  if (t === "") {
    errors.total = "Jumlah seluruh suku kata wajib diisi.";
  } else if (!INTEGER.test(t)) {
    errors.total = "Gunakan bilangan bulat positif (tanpa koma, tanda minus, atau huruf).";
  } else {
    total = Number(t);
    if (total === 0) {
      errors.total = "Jumlah seluruh suku kata harus lebih dari 0 (tidak dapat membagi dengan nol).";
    } else if (total > MAX_SYLLABLES) {
      errors.total = `Maksimal ${MAX_SYLLABLES.toLocaleString("id-ID")} suku kata per sampel.`;
    }
  }

  if (s === "") {
    errors.stuttered = "Jumlah suku kata gagap wajib diisi (isi 0 bila tidak ada).";
  } else if (!INTEGER.test(s)) {
    errors.stuttered = "Gunakan bilangan bulat ≥ 0 (tanpa koma, tanda minus, atau huruf).";
  } else {
    stuttered = Number(s);
    if (!errors.total && total !== null && stuttered > total) {
      errors.stuttered = "Suku kata gagap tidak boleh melebihi jumlah seluruh suku kata.";
    }
  }

  const valid = !errors.total && !errors.stuttered && total !== null && stuttered !== null;
  return {
    valid,
    total,
    stuttered,
    errors,
    percentage: valid ? computeSS(stuttered as number, total as number) : null,
  };
}

/**
 * Klasifikasi derajat keparahan berbasis %SS (Stuttering Severity Instrument guideline)
 */
export function getSSISeverity(ssPercentage: number): {
  label: string;
  tone: "success" | "brand" | "warning" | "danger";
  description: string;
} {
  if (ssPercentage < 3) {
    return {
      label: "Sangat Ringan (Very Mild)",
      tone: "success",
      description: "< 3% SS: Dalam batas fluktuasi kelancaran normal.",
    };
  }
  if (ssPercentage <= 7) {
    return {
      label: "Ringan (Mild)",
      tone: "brand",
      description: "3% - 7% SS: Ketidaklancaran tingkat ringan.",
    };
  }
  if (ssPercentage <= 15) {
    return {
      label: "Sedang (Moderate)",
      tone: "warning",
      description: "8% - 15% SS: Memerlukan intervensi terapi wicara terstruktur.",
    };
  }
  if (ssPercentage <= 25) {
    return {
      label: "Berat (Severe)",
      tone: "danger",
      description: "16% - 25% SS: Mempengaruhi kelancaran komunikasi secara signifikan.",
    };
  }
  return {
    label: "Sangat Berat (Very Severe)",
    tone: "danger",
    description: "> 25% SS: Memerlukan program terapi klinis intensif.",
  };
}

/**
 * Menghitung jumlah kata dari teks ucapan.
 */
export function countWords(text: string): number {
  if (!text || !text.trim()) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Estimasi jumlah suku kata bahasa Indonesia berbasis gugus vokal & diftong.
 * Suku kata rata-rata per kata bahasa Indonesia berkisar antara 2 hingga 3 suku kata.
 */
export function countIndonesianSyllables(text: string): number {
  const clean = text.toLowerCase().replace(/[^a-z\s]/g, " ").trim();
  if (!clean) return 0;
  const words = clean.split(/\s+/).filter(Boolean);
  let total = 0;
  for (const word of words) {
    // Gabungan konsonan Indonesia
    // Diftong (ai, au, oi, ei) dihitung sebagai 1 inti vokal suku kata
    const normalized = word
      .replace(/kh|ng|ny|sy/g, "k")
      .replace(/ai|au|oi|ei/g, "a");
    const vowels = normalized.match(/[aiueo]/g);
    const count = vowels ? vowels.length : 1;
    total += Math.max(1, count);
  }
  return total;
}

