import bandDataSimplified from './3GPP-NR-FR1-simplified.json';

interface Result {
    inputValue: number;
    gscn?: number;
    ssbFreq?: number;
    ssbArfcn?: number;
}

interface BandInfo {
    band: string;
    low_arfcn: number;
    high_arfcn: number;
    low_freq: number;
    high_freq: number;
    low_uplink_freq: number;
    high_uplink_freq: number;
    min_gscn: number;
    max_gscn: number;
    step_size: number;
    mode: string;
}

export function frequencyToGSCN(frequency: number): { gscn: number; ssbFreq: number } {
    let bestGSCN = 0;
    let bestFreq = 0;
    let minDiff = Number.POSITIVE_INFINITY;

    if (frequency < 3000.0) {
        const nStart = Math.floor(frequency / 1.2);
        for (let n = nStart - 1; n <= nStart + 1; n++) {
            for (const m of [1, 3, 5]) {
                const fSSB = n * 1.2 + m * 0.05;
                const diff = Math.abs(frequency - fSSB);
                if (diff < minDiff) {
                    minDiff = diff;
                    bestFreq = fSSB;
                    bestGSCN = 3 * n + (m - 3) / 2;
                }
            }
        }

        const arfcn = Math.round(bestFreq / 0.005);
        bestFreq = arfcn * 0.005;
    } else if (frequency < 24250.0) {
        const n = Math.round((frequency - 3000.0) / 1.44);
        bestGSCN = 7499 + n;
        bestFreq = 3000.0 + n * 1.44;
    } else {
        const n = Math.round((frequency - 24250.08) / 17.28);
        bestGSCN = 22256 + n;
        bestFreq = 24250.08 + n * 17.28;
    }

    return { gscn: bestGSCN, ssbFreq: bestFreq };
}

export function gscnToFrequency(gscn: number): number {
    let frequency = 0;

    if (gscn < 7499) {
        const remainder = ((gscn % 3) + 3) % 3;
        const offset = remainder === 0 ? 0 : remainder === 1 ? 1 : -1;
        const n = (gscn - offset) / 3;
        const m = remainder === 0 ? 3 : remainder === 1 ? 5 : 1;
        frequency = n * 1.2 + m * 0.05;
    } else if (gscn < 22256) {
        const n = gscn - 7499;
        frequency = 3000.0 + n * 1.44;
    } else {
        const n = gscn - 22256;
        frequency = 24250.08 + n * 17.28;
    }

    return frequency;
}

export function frequencyToARFCN(frequency: number): number {
    let arfcn = 0;
    if (frequency < 3000.0) {
        arfcn = Math.round(frequency / 0.005);
    } else if (frequency < 24250.0) {
        arfcn = Math.round((frequency - 3000.0) / 0.015) + 600000;
    } else {
        arfcn = Math.round((frequency - 24250.08) / 0.06) + 2016667;
    }
    return arfcn;
}

export function arfcnToFrequency(arfcn: number): number {
    let frequency = 0;
    if (arfcn < 600000) {
        frequency = arfcn * 0.005;
    } else if (arfcn < 2016667) {
        frequency = 3000.0 + (arfcn - 600000) * 0.015;
    } else {
        frequency = 24250.08 + (arfcn - 2016667) * 0.06;
    }
    return frequency;
}

export function findBandByFrequency(frequency: number): BandInfo | null {
    for (const [bandKey, bandInfo] of Object.entries(bandDataSimplified as Record<string, any>)) {
        if (frequency >= bandInfo.low_freq && frequency <= bandInfo.high_freq) {
            return {
                band: bandKey,
                ...bandInfo,
            };
        }
    }
    return null;
}

export function findBandByARFCN(arfcn: number): BandInfo | null {
    for (const [bandKey, bandInfo] of Object.entries(bandDataSimplified as Record<string, any>)) {
        if (arfcn >= bandInfo.low_arfcn && arfcn <= bandInfo.high_arfcn) {
            return {
                band: bandKey,
                ...bandInfo,
            };
        }
    }
    return null;
}

export function findBandsByFrequency(frequency: number): BandInfo[] {
    const matches: BandInfo[] = [];
    for (const [bandKey, bandInfo] of Object.entries(bandDataSimplified as Record<string, any>)) {
        if (frequency >= bandInfo.low_freq && frequency <= bandInfo.high_freq) {
            matches.push({
                band: bandKey,
                ...bandInfo,
            });
        }
    }
    return matches;
}

export function findBandsByARFCN(arfcn: number): BandInfo[] {
    const matches: BandInfo[] = [];
    for (const [bandKey, bandInfo] of Object.entries(bandDataSimplified as Record<string, any>)) {
        if (arfcn >= bandInfo.low_arfcn && arfcn <= bandInfo.high_arfcn) {
            matches.push({
                band: bandKey,
                ...bandInfo,
            });
        }
    }
    return matches;
}

export interface GSCNValidationResult {
    gscn: number;
    isStandard: boolean;
    closestStandardGSCN?: number;
    closestStandardARFCN?: number;
}

export function validateGlobalGSCN(gscn: number, inputFrequency: number): GSCNValidationResult {
    const gscnFrequency = gscnToFrequency(gscn);
    const isStandard = Math.abs(gscnFrequency - inputFrequency) < 0.0001;

    let closestStandardGSCN: number | undefined;
    let closestStandardARFCN: number | undefined;

    if (!isStandard) {
        const { gscn: closestGscn } = frequencyToGSCN(inputFrequency);
        closestStandardGSCN = closestGscn;
        closestStandardARFCN = frequencyToARFCN(gscnToFrequency(closestGscn));
    }

    return {
        gscn,
        isStandard,
        closestStandardGSCN,
        closestStandardARFCN,
    };
}

export function validateGSCN(
    gscn: number,
    band: BandInfo,
    inputFrequency?: number
): GSCNValidationResult {
    void band;

    if (inputFrequency === undefined) {
        return {
            gscn,
            isStandard: true,
        };
    }

    // Keep validation logic aligned with conversion output (global raster only).
    return validateGlobalGSCN(gscn, inputFrequency);
}

export type { BandInfo };