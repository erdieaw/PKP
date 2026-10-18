import { OfficialIndicator } from '../types/pkp';

export interface CalculationResult {
  capaianRiilPct: number;
  nilaiKinerja: number;
  statusLabel: 'Baik' | 'Cukup' | 'Kurang';
  statusColor: 'emerald' | 'amber' | 'rose';
}

/**
 * Evaluasi skor kinerja berdasarkan aturan polaritas indikator (Higher vs Lower vs Tiered)
 * Sesuai instrumen Excel PKP ILP Kemenkes 2026.
 */
export function calculateIndicatorScore(
  indicator: OfficialIndicator,
  pencapaianRiil: number,
  totalSasaran: number,
  targetSasaran: number
): CalculationResult {
  // Safe zero denominator handling
  if (totalSasaran <= 0 && targetSasaran <= 0) {
    return {
      capaianRiilPct: 0,
      nilaiKinerja: 100, // Sasaran nihil diartikan tidak ada beban kasus / netral
      statusLabel: 'Baik',
      statusColor: 'emerald'
    };
  }

  const realisasiPct = totalSasaran > 0 ? (pencapaianRiil / totalSasaran) * 100 : 0;
  let score = 0;

  // 1. TIERED BRACKETS RULES
  if (indicator.id === 'K3-R40') {
    // Akseptor KB Drop Out (< 15%)
    if (realisasiPct < 15) score = 100;
    else if (realisasiPct <= 17.5) score = 75;
    else if (realisasiPct <= 20) score = 50;
    else if (realisasiPct <= 22.5) score = 22.5;
    else score = 0;
  } else if (indicator.id === 'K3-R41') {
    // Peserta KB Komplikasi (< 3.5%)
    if (realisasiPct < 3.5) score = 100;
    else if (realisasiPct <= 4.5) score = 75;
    else if (realisasiPct <= 7.5) score = 50;
    else if (realisasiPct <= 10) score = 25;
    else score = 0;
  } else if (indicator.id === 'K5-R23') {
    // POR ISPA Non-Pneumonia (<= 20%)
    if (realisasiPct <= 20) score = 100;
    else if (realisasiPct <= 40) score = 75;
    else if (realisasiPct <= 60) score = 50;
    else if (realisasiPct <= 80) score = 25;
    else score = 0;
  } else if (indicator.id === 'K5-R24') {
    // POR Diare Non-Spesifik (<= 8%)
    if (realisasiPct <= 8) score = 100;
    else if (realisasiPct <= 20) score = 75;
    else if (realisasiPct <= 40) score = 50;
    else if (realisasiPct <= 60) score = 25;
    else score = 0;
  } else if (indicator.id === 'K5-R25') {
    // Injeksi Myalgia (<= 1%)
    if (realisasiPct <= 1) score = 100;
    else if (realisasiPct <= 10) score = 75;
    else if (realisasiPct <= 20) score = 50;
    else if (realisasiPct <= 30) score = 25;
    else score = 0;
  } else if (indicator.id === 'K5-R26') {
    // Rerata Item Obat (<= 2.6)
    const rerata = totalSasaran > 0 ? pencapaianRiil / totalSasaran : pencapaianRiil;
    if (rerata <= 2.6) score = 100;
    else if (rerata <= 4.0) score = 75;
    else if (rerata <= 7.0) score = 50;
    else if (rerata <= 9.0) score = 25;
    else score = 0;
  } 
  // 2. LOWER IS BETTER (Invers Sederhana)
  else if (indicator.id === 'K2-R50') {
    // Prevalensi Stunting (<= 15.04%)
    score = realisasiPct <= 15.04 ? 100 : 0;
  } else if (indicator.id === 'K2-R52') {
    // Prevalensi Wasting (<= 8.0%)
    score = realisasiPct <= 8.0 ? 100 : 0;
  } else if (indicator.polarity === 'LOWER_IS_BETTER') {
    const targetMax = indicator.targetNumeric * 100;
    score = realisasiPct <= targetMax ? 100 : Math.max(0, 100 - (realisasiPct - targetMax) * 2);
  } 
  // 3. HIGHER IS BETTER (Standar Pelayanan / Cakupan)
  else {
    if (targetSasaran > 0) {
      score = Math.min(100, (pencapaianRiil / targetSasaran) * 100);
    } else {
      score = 100;
    }
  }

  // Klasifikasi Mutu Kinerja Kemenkes
  let statusLabel: 'Baik' | 'Cukup' | 'Kurang' = 'Kurang';
  let statusColor: 'emerald' | 'amber' | 'rose' = 'rose';

  if (score >= 91) {
    statusLabel = 'Baik';
    statusColor = 'emerald';
  } else if (score >= 81) {
    statusLabel = 'Cukup';
    statusColor = 'amber';
  } else {
    statusLabel = 'Kurang';
    statusColor = 'rose';
  }

  return {
    capaianRiilPct: Number(realisasiPct.toFixed(2)),
    nilaiKinerja: Number(score.toFixed(2)),
    statusLabel,
    statusColor
  };
}

/**
 * Menghitung rekapitulasi nilai per Klaster dan Total Nilai Kinerja Puskesmas
 */
export function calculateRollup(scores: { klasterId: number; score: number }[]) {
  const klasterMap: Record<number, number[]> = { 1: [], 2: [], 3: [], 4: [], 5: [] };

  scores.forEach(s => {
    if (klasterMap[s.klasterId]) {
      klasterMap[s.klasterId].push(s.score);
    }
  });

  const klasterAverages: Record<number, number> = {};
  for (let k = 1; k <= 5; k++) {
    const arr = klasterMap[k];
    klasterAverages[k] = arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  }

  // Rata-rata 5 klaster sesuai formula resmi Sheet 7: (D6+D19+D25+D28+D32)/5
  const totalPKP = (
    klasterAverages[1] +
    klasterAverages[2] +
    klasterAverages[3] +
    klasterAverages[4] +
    klasterAverages[5]
  ) / 5;

  let kategoriPKP: 'Kinerja Baik' | 'Kinerja Cukup' | 'Kinerja Kurang' = 'Kinerja Kurang';
  if (totalPKP >= 91) kategoriPKP = 'Kinerja Baik';
  else if (totalPKP >= 81) kategoriPKP = 'Kinerja Cukup';

  return {
    klasterAverages,
    totalPKP: Number(totalPKP.toFixed(2)),
    kategoriPKP
  };
}
