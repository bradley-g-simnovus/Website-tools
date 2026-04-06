import React, { useState } from 'react';
import { 
    frequencyToGSCN, 
    frequencyToARFCN, 
    arfcnToFrequency,
    findBandByFrequency,
    findBandByARFCN,
    findBandsByFrequency,
    findBandsByARFCN,
    validateGSCN,
    validateGlobalGSCN,
    type BandInfo,
} from './calculations';
import { Calculator, Check, X } from 'lucide-react';
import logoDark from '../../logo_dark.svg';

type InputType = 'arfcn' | 'frequency';
type AuxConverterMode = 'arfcnToFreq' | 'freqToArfcn';

interface Result {
    inputValue: number;
    gscn?: number;
    ssbFreq?: number;
    ssbArfcn?: number;
    band?: BandInfo | null;
    bands?: BandInfo[];
    gscnValidation?: {
        isStandard: boolean;
        closestStandardGSCN?: number;
        closestStandardARFCN?: number;
    };
}

interface ParameterRow {
    label: string;
    value: string | number;
}

interface ResultCardProps {
    icon: React.ReactNode;
    label: string;
    value: string | number | undefined;
    unit?: string;
    iconBgColor?: string;
}

interface ParametersTableProps {
    parameters: ParameterRow[];
    title?: string;
}

interface BandInfoTableProps {
    bands: BandInfo[];
    title?: string;
}

const btnInlineStyles = {
    base: {
        padding: '10px 16px',
        borderRadius: '12px',
        fontSize: '15px',
        fontWeight: '600',
        transition: 'all 200ms',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        border: '2px solid',
        boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
        cursor: 'pointer',
        width: '100%',
    } as React.CSSProperties,
    primary: {
        backgroundColor: '#F27024',
        color: '#ffffff',
        borderColor: '#F27024',
    } as React.CSSProperties,
    secondary: {
        backgroundColor: '#ffffff',
        color: '#6b7280',
        borderColor: '#E5E7EB',
    } as React.CSSProperties,
};

function ResultCard({ icon, label, value, unit, iconBgColor = 'bg-orange-50' }: ResultCardProps) {
    return (
        <div className="bg-white rounded-2xl p-8 border border-gray-100 shadow-sm flex flex-col items-center justify-center text-center gap-4 transition-all hover:shadow-md">
            <div className={`w-12 h-12 ${iconBgColor} rounded-2xl flex items-center justify-center`}>
                {icon}
            </div>
            <div className="space-y-1">
                <p className="text-sm font-medium text-gray-500 uppercase tracking-widest">{label}</p>
                <p className="text-5xl font-black text-gray-900 tabular-nums">
                    {value} {unit && <span className="text-2xl font-bold text-gray-400">{unit}</span>}
                </p>
            </div>
        </div>
    );
}

function ParametersTable({ parameters, title = 'Parameters' }: ParametersTableProps) {
    return (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between">
                <span className="text-sm font-bold text-gray-700 uppercase tracking-wider">{title}</span>
            </div>
            <div className="divide-y divide-gray-50">
                {parameters.map((param, idx) => (
                    <div key={idx} className="grid grid-cols-2 px-6 py-4 hover:bg-gray-50 transition-colors">
                        <span className="text-sm text-gray-500">{param.label}</span>
                        <span className="text-sm font-bold text-gray-900 text-right">{param.value}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

function BandInfoTable({ bands, title = 'Band Information' }: BandInfoTableProps) {
    return (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between">
                <span className="text-sm font-bold text-gray-700 uppercase tracking-wider">{title}</span>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full">
                    <thead className="bg-gray-50 border-b border-gray-100">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Band</th>
                            <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">DL Frequency Range</th>
                            <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">UL Frequency Range</th>
                            <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Mode</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                        {bands.map((band) => (
                            <tr key={band.band} className="hover:bg-gray-50 transition-colors">
                                <td className="px-6 py-4 text-sm font-bold text-gray-900">{band.band}</td>
                                <td className="px-6 py-4 text-sm text-gray-700">{band.low_freq}-{band.high_freq} MHz</td>
                                <td className="px-6 py-4 text-sm text-gray-700">{band.low_uplink_freq}-{band.high_uplink_freq} MHz</td>
                                <td className="px-6 py-4 text-sm font-semibold text-gray-900">{band.mode}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

export function NRGSCNCalculator() {
    const [inputType, setInputType] = useState<InputType>('arfcn');
    const [input, setInput] = useState<string>('');
    const [result, setResult] = useState<Result | null>(null);
    const [showAuxConverter, setShowAuxConverter] = useState<boolean>(false);
    const [auxMode, setAuxMode] = useState<AuxConverterMode>('arfcnToFreq');
    const [auxInput, setAuxInput] = useState<string>('');

    const handleCalculate = () => {
        const value = parseFloat(input);
        if (isNaN(value)) {
            setResult(null);
            return;
        }

        let calcResult: Result | null = null;
        let bandInfo: BandInfo | null = null;
        let bandMatches: BandInfo[] = [];
        let gscn = 0;
        let ssbFreq = 0;
        let ssbArfcn = 0;

        if (inputType === 'arfcn') {
            const arfcn = Math.round(value);
            const frequency = arfcnToFrequency(arfcn);
            const gscnResult = frequencyToGSCN(frequency);
            gscn = gscnResult.gscn;
            ssbFreq = gscnResult.ssbFreq;
            ssbArfcn = frequencyToARFCN(ssbFreq);
            
            bandMatches = findBandsByARFCN(arfcn);
            bandInfo = bandMatches[0] ?? findBandByARFCN(arfcn);
            
            calcResult = {
                inputValue: frequency,
                gscn,
                ssbFreq,
                ssbArfcn,
                band: bandInfo,
                bands: bandMatches,
            };
        } else if (inputType === 'frequency') {
            const { gscn: calculatedGscn, ssbFreq: calculatedSsbFreq } = frequencyToGSCN(value);
            const arfcn = frequencyToARFCN(calculatedSsbFreq);
            
            gscn = calculatedGscn;
            ssbFreq = calculatedSsbFreq;
            ssbArfcn = arfcn;
            
            bandMatches = findBandsByFrequency(value);
            bandInfo = bandMatches[0] ?? findBandByFrequency(value);
            
            calcResult = {
                inputValue: value,
                gscn,
                ssbFreq,
                ssbArfcn,
                band: bandInfo,
                bands: bandMatches,
            };
        }

        if (calcResult) {
            const validation = bandInfo
                ? validateGSCN(gscn, bandInfo, calcResult.inputValue)
                : validateGlobalGSCN(gscn, calcResult.inputValue);

            calcResult.gscnValidation = {
                isStandard: validation.isStandard,
                closestStandardGSCN: validation.closestStandardGSCN,
                closestStandardARFCN: validation.closestStandardARFCN,
            };
        }

        setResult(calcResult);
    };

    const getModeLabel = (): string => {
        return inputType === 'arfcn' ? 'NR ARFCN' : 'Frequency (MHz)';
    };

    const getAuxOutputValue = (): string => {
        const value = parseFloat(auxInput);
        if (isNaN(value)) {
            return '';
        }

        if (auxMode === 'arfcnToFreq') {
            return arfcnToFrequency(Math.round(value)).toFixed(2);
        }

        return String(frequencyToARFCN(value));
    };

    const getResultDisplay = () => {
        if (!result) {
            return null;
        }

        const conversionParams: ParameterRow[] = [
            { label: inputType === 'arfcn' ? 'Calculated Frequency' : 'Input Frequency', value: `${result.inputValue?.toFixed(2)} MHz` },
            { label: 'GSCN', value: result.gscn! },
            { label: 'SSB ARFCN', value: result.ssbArfcn! },
            { label: 'SSB Frequency', value: `${result.ssbFreq?.toFixed(2)} MHz` },
        ];

        const bandParams: ParameterRow[] = result.bands && result.bands.length > 0 ? [] : [
            { label: 'Band', value: 'Not found' },
        ];

        const gscnValidStatus = result.gscnValidation?.isStandard ? 'Standard' : 'Non-Standard';
        const statusIcon = result.gscnValidation?.isStandard ? 
            <Check className="w-6 h-6 text-green-600" /> : 
            <X className="w-6 h-6 text-red-600" />;
        const gscnCardLabel = result.gscnValidation?.isStandard === false ? 'Closest GSCN' : 'GSCN';

        const validationParams: ParameterRow[] = [
            { label: 'GSCN Status', value: gscnValidStatus },
            ...(result.gscnValidation?.closestStandardGSCN !== undefined ? [
                { label: 'Closest Standard GSCN', value: result.gscnValidation.closestStandardGSCN },
                { label: 'Closest Standard ARFCN', value: result.gscnValidation.closestStandardARFCN! },
            ] : []),
        ];

        return (
            <div className="space-y-6">
                {/* GSCN Validation */}
                <div className="space-y-4">
                    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                        <div className="px-6 py-4 border-b border-gray-50 flex items-center gap-3">
                            {statusIcon}
                            <span className="text-sm font-bold text-gray-700 uppercase tracking-wider">GSCN Validation</span>
                        </div>
                        <div className="divide-y divide-gray-50">
                            {validationParams.map((param, idx) => (
                                <div key={idx} className="grid grid-cols-2 px-6 py-4 hover:bg-gray-50 transition-colors">
                                    <span className="text-sm text-gray-500">{param.label}</span>
                                    <span className="text-sm font-bold text-gray-900 text-right">{param.value}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                <ParametersTable parameters={conversionParams} title="Conversion Results" />
                {result.bands && result.bands.length > 0 ? (
                    <BandInfoTable bands={result.bands} title="Band Information" />
                ) : (
                    <ParametersTable parameters={bandParams} title="Band Information" />
                )}
            </div>
        );
    };

    return (
        <div className="w-full h-[100dvh] md:h-screen bg-gray-50 text-gray-800 font-sans flex flex-col md:flex-row overflow-hidden">
            <div className="flex flex-col md:flex-row overflow-y-auto md:overflow-hidden flex-1 w-full min-h-0 pb-16 md:pb-0">
                <div className="calc-sidebar md:shrink-0 bg-white md:border-r border-gray-200 p-6 md:p-8 flex flex-col gap-8 w-full md:w-96 shadow-sm md:h-screen md:overflow-y-auto h-auto">
                    {/* Header */}
                    <div className="flex flex-col items-center gap-4">
                        <img src={logoDark} alt="Simnovus" className="h-10 w-auto object-contain" />
                        <h1 className="text-xl font-bold text-gray-900 tracking-tight">SSB Calculator</h1>
                    </div>

                    {/* Input Section */}
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Input Type</label>
                            <div className="grid grid-cols-2 gap-2">
                                {(['arfcn', 'frequency'] as InputType[]).map((type) => (
                                    <button
                                        key={type}
                                        onClick={() => {
                                            setInputType(type);
                                            setInput('');
                                            setResult(null);
                                        }}
                                        className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                                            inputType === type
                                                ? 'bg-[#F27024] text-white'
                                                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                        }`}
                                    >
                                        {type === 'arfcn' ? 'ARFCN' : 'Frequency'}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">{getModeLabel()}</label>
                            <div className="relative">
                                <input
                                    type="number"
                                    placeholder={`Enter ${getModeLabel()}`}
                                    value={input}
                                    onChange={(e) => setInput(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleCalculate()}
                                    className="w-full bg-white border border-gray-200 rounded-xl pl-4 pr-4 py-2.5 text-sm md:text-base input-focus transition-all"
                                />
                            </div>
                        </div>

                        <button
                            onClick={handleCalculate}
                            style={{ ...btnInlineStyles.base, ...btnInlineStyles.primary }}
                            className="hover:scale-[1.02] active:scale-[0.98]"
                        >
                            CALCULATE
                        </button>

                        <div className="border border-gray-200 rounded-xl overflow-hidden">
                            <button
                                type="button"
                                onClick={() => setShowAuxConverter((prev) => !prev)}
                                className="w-full px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors flex items-center justify-between"
                            >
                                <span className="text-xs font-semibold text-gray-700 uppercase tracking-wider">ARFCN / Frequency Converter</span>
                                <span className="text-gray-500 text-sm">{showAuxConverter ? '▲' : '▼'}</span>
                            </button>

                            {showAuxConverter && (
                                <div className="p-4 space-y-3 bg-white">
                                    <div className="grid grid-cols-2 gap-2">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setAuxMode('arfcnToFreq');
                                                setAuxInput('');
                                            }}
                                            className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                                                auxMode === 'arfcnToFreq'
                                                    ? 'bg-[#F27024] text-white'
                                                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                            }`}
                                        >
                                            ARFCN → Freq
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setAuxMode('freqToArfcn');
                                                setAuxInput('');
                                            }}
                                            className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                                                auxMode === 'freqToArfcn'
                                                    ? 'bg-[#F27024] text-white'
                                                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                            }`}
                                        >
                                            Freq → ARFCN
                                        </button>
                                    </div>

                                    <div className="space-y-1.5">
                                        <label className="text-[11px] font-medium text-gray-500 uppercase tracking-wider">
                                            {auxMode === 'arfcnToFreq' ? 'Input ARFCN' : 'Input Frequency (MHz)'}
                                        </label>
                                        <input
                                            type="number"
                                            value={auxInput}
                                            onChange={(e) => setAuxInput(e.target.value)}
                                            placeholder={auxMode === 'arfcnToFreq' ? 'Enter ARFCN' : 'Enter Frequency'}
                                            className="w-full bg-white border border-gray-200 rounded-xl px-4 py-2.5 text-sm input-focus transition-all"
                                        />
                                    </div>

                                    <div className="space-y-1.5">
                                        <label className="text-[11px] font-medium text-gray-500 uppercase tracking-wider">
                                            {auxMode === 'arfcnToFreq' ? 'Output Frequency (MHz)' : 'Output ARFCN'}
                                        </label>
                                        <input
                                            type="text"
                                            value={getAuxOutputValue()}
                                            readOnly
                                            placeholder="Calculated value"
                                            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-700"
                                        />
                                    </div>
                                </div>
                            )}
                        </div>
                        <div className="space-y-1.5">
                        <a
                            href="/band-info"
                            style={{ ...btnInlineStyles.base, ...btnInlineStyles.secondary }}
                            className="text-center"
                        >
                            Band Information
                        </a>
                    </div>
                    </div>
                </div>

                {/* Main Results Panel */}
                <div className="flex-1 bg-gray-50 p-6 md:p-12 w-full md:h-screen md:overflow-y-auto min-h-0 pb-6 md:pb-12">
                    <div className="max-w-4xl pb-8 mx-auto space-y-8">
                        {result ? (
                            <>
                                <div className="flex flex-col gap-1">
                                    <h2 className="text-2xl font-bold text-gray-900">Results</h2>
                                </div>
                                {getResultDisplay()}
                            </>
                        ) : (
                            <div className="bg-white rounded-2xl p-12 border border-gray-100 shadow-sm flex flex-col items-center justify-center text-center gap-4">
                                <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center text-gray-300">
                                    <Calculator className="w-8 h-8" />
                                </div>
                                <div className="space-y-2">
                                    <p className="text-lg font-bold text-gray-900">No Calculation Data</p>
                                    <p className="text-gray-500">Please enter a valid value to begin.</p>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default NRGSCNCalculator;