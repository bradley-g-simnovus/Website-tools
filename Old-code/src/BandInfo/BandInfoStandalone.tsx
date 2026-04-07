import React, { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import nrBands from './NR.json';
import lteBands from './LTE.json';
import logoDark from '../../logo_dark.svg';

type Rat = 'NR' | 'LTE';

interface FrequencyRangeSource {
  low?: number;
  middle?: number;
  center?: number;
  high?: number;
  low_nr_arfcn?: number;
  middle_nr_arfcn?: number;
  high_nr_arfcn?: number;
  low_earfcn?: number;
  center_earfcn?: number;
  high_earfcn?: number;
}

interface RawBandSource {
  band: string;
  name: string;
  mode: string;
  geographical_area?: string;
  release_3gpp?: number;
  downlink_mhz?: FrequencyRangeSource;
  uplink_mhz?: FrequencyRangeSource;
  scs_khz?: number[];
  scs_bandwidth_mapping?: Record<string, number[]>;
  channel_bandwidth_mhz?: number[];
}

interface FrequencyRange {
  low?: number;
  centre?: number;
  high?: number;
  lowArfcn?: number;
  centreArfcn?: number;
  highArfcn?: number;
}

interface ScsBandwidthCombination {
  scs: number;
  bandwidths: number[];
}

interface NormalizedBand {
  rat: Rat;
  band: string;
  bandName: string;
  mode: string;
  geoArea: string;
  release: string;
  dlFreqRange: FrequencyRange;
  ulFreqRange: FrequencyRange;
  scs: number[];
  scsBandwidthCombination: ScsBandwidthCombination[];
}

interface Filters {
  search: string;
  mode: string;
  geoArea: string;
  release: string;
  supportedBandwidth: string;
  freqFrom: string;
  freqTo: string;
}

interface SortConfig {
  field: keyof Pick<NormalizedBand, 'band' | 'bandName' | 'mode' | 'geoArea' | 'release'>;
  direction: 'asc' | 'desc';
}

const INITIAL_FILTERS: Filters = {
  search: '',
  mode: '',
  geoArea: '',
  release: '',
  supportedBandwidth: '',
  freqFrom: '',
  freqTo: '',
};

const INITIAL_SORT: SortConfig = {
  field: 'band',
  direction: 'asc',
};

function transformData(data: RawBandSource[], rat: Rat): NormalizedBand[] {
  return data.map((item) => {
    const normalized: NormalizedBand = {
      rat,
      band: item.band,
      bandName: item.name,
      mode: item.mode,
      geoArea: item.geographical_area || '',
      release: item.release_3gpp ? String(Math.floor(item.release_3gpp)) : '',
      dlFreqRange: {},
      ulFreqRange: {},
      scs: rat === 'NR' ? item.scs_khz || [] : [],
      scsBandwidthCombination: [],
    };

    if (rat === 'NR') {
      normalized.dlFreqRange = {
        low: item.downlink_mhz?.low,
        centre: item.downlink_mhz?.middle,
        high: item.downlink_mhz?.high,
        lowArfcn: item.downlink_mhz?.low_nr_arfcn,
        centreArfcn: item.downlink_mhz?.middle_nr_arfcn,
        highArfcn: item.downlink_mhz?.high_nr_arfcn,
      };

      normalized.ulFreqRange = {
        low: item.uplink_mhz?.low,
        centre: item.uplink_mhz?.middle,
        high: item.uplink_mhz?.high,
        lowArfcn: item.uplink_mhz?.low_nr_arfcn,
        centreArfcn: item.uplink_mhz?.middle_nr_arfcn,
        highArfcn: item.uplink_mhz?.high_nr_arfcn,
      };

      if (item.scs_bandwidth_mapping) {
        normalized.scsBandwidthCombination = Object.entries(item.scs_bandwidth_mapping).map(([scs, bws]) => ({
          scs: Number.parseInt(scs, 10),
          bandwidths: bws.map(Number),
        }));
      }
    } else {
      normalized.dlFreqRange = {
        low: item.downlink_mhz?.low,
        centre: item.downlink_mhz?.center,
        high: item.downlink_mhz?.high,
        lowArfcn: item.downlink_mhz?.low_earfcn,
        centreArfcn: item.downlink_mhz?.center_earfcn,
        highArfcn: item.downlink_mhz?.high_earfcn,
      };

      normalized.ulFreqRange = {
        low: item.uplink_mhz?.low,
        centre: item.uplink_mhz?.center,
        high: item.uplink_mhz?.high,
        lowArfcn: item.uplink_mhz?.low_earfcn,
        centreArfcn: item.uplink_mhz?.center_earfcn,
        highArfcn: item.uplink_mhz?.high_earfcn,
      };

      if (item.channel_bandwidth_mhz) {
        normalized.scsBandwidthCombination = [
          {
            scs: 0,
            bandwidths: item.channel_bandwidth_mhz.map(Number),
          },
        ];
      }
    }

    return normalized;
  });
}

function formatValue(value?: number) {
  if (value === undefined || value === null || Number.isNaN(value) || value === -1) {
    return '—';
  }

  return String(value);
}

function matchesRange(range: FrequencyRange, fromText: string, toText: string) {
  const hasFrom = fromText.trim() !== '';
  const hasTo = toText.trim() !== '';

  if (!hasFrom && !hasTo) {
    return true;
  }

  if (typeof range.low !== 'number' || typeof range.high !== 'number') {
    return false;
  }

  const from = hasFrom ? Number.parseFloat(fromText) : Number.NEGATIVE_INFINITY;
  const to = hasTo ? Number.parseFloat(toText) : Number.POSITIVE_INFINITY;

  return range.low <= to && range.high >= from;
}

export function BandInfoStandalone() {
  const [currentRat, setCurrentRat] = useState<Rat>('NR');
  const [filters, setFilters] = useState<Filters>(INITIAL_FILTERS);
  const [sortConfig, setSortConfig] = useState<SortConfig>(INITIAL_SORT);
  const [selectedBand, setSelectedBand] = useState<NormalizedBand | null>(null);

  const rawData = useMemo(
    () => transformData((currentRat === 'NR' ? nrBands : lteBands) as RawBandSource[], currentRat),
    [currentRat]
  );

  const filterOptions = useMemo(() => {
    const getUniqueValues = (field: keyof Pick<NormalizedBand, 'mode' | 'geoArea' | 'release'>) => {
      const values = [...new Set(rawData.map((item) => item[field]).filter(Boolean))];

      if (field === 'release') {
        return values.sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));
      }

      return values.sort();
    };

    const allBandwidths = [...new Set(
      rawData.flatMap((item) => item.scsBandwidthCombination.flatMap((combination) => combination.bandwidths.map((bw) => Math.floor(bw))))
    )].sort((a, b) => a - b);

    return {
      mode: getUniqueValues('mode'),
      geoArea: getUniqueValues('geoArea'),
      release: getUniqueValues('release'),
      supportedBandwidth: allBandwidths,
    };
  }, [rawData]);

  const filteredData = useMemo(() => {
    const search = filters.search.trim().toLowerCase();

    const filtered = rawData.filter((item) => {
      if (search && !item.band.toLowerCase().includes(search)) {
        return false;
      }

      if (filters.mode && item.mode !== filters.mode) {
        return false;
      }

      if (filters.geoArea && item.geoArea !== filters.geoArea) {
        return false;
      }

      if (filters.release && item.release !== filters.release) {
        return false;
      }

      if (filters.supportedBandwidth) {
        const selectedBandwidth = Number.parseInt(filters.supportedBandwidth, 10);
        const hasMatch = item.scsBandwidthCombination.some((combination) =>
          combination.bandwidths.some((bandwidth) => Math.floor(bandwidth) === selectedBandwidth)
        );

        if (!hasMatch) {
          return false;
        }
      }

      if (!matchesRange(item.dlFreqRange, filters.freqFrom, filters.freqTo) && !matchesRange(item.ulFreqRange, filters.freqFrom, filters.freqTo)) {
        return false;
      }

      return true;
    });

    return filtered.sort((a, b) => {
      let valueA: string | number = a[sortConfig.field];
      let valueB: string | number = b[sortConfig.field];

      if (sortConfig.field === 'band') {
        const getNumericPart = (value: string) => Number.parseInt(value.replace(/\D/g, ''), 10) || 0;
        valueA = getNumericPart(valueA);
        valueB = getNumericPart(valueB);
      } else if (sortConfig.field === 'release') {
        valueA = Number.parseInt(String(valueA), 10) || 0;
        valueB = Number.parseInt(String(valueB), 10) || 0;
      } else {
        valueA = String(valueA).toLowerCase();
        valueB = String(valueB).toLowerCase();
      }

      if (valueA < valueB) {
        return sortConfig.direction === 'asc' ? -1 : 1;
      }

      if (valueA > valueB) {
        return sortConfig.direction === 'asc' ? 1 : -1;
      }

      return 0;
    });
  }, [filters, rawData, sortConfig]);

  const updateFilter = <K extends keyof Filters>(field: K, value: Filters[K]) => {
    setFilters((previous) => ({
      ...previous,
      [field]: value,
    }));
  };

  const handleSort = (field: SortConfig['field']) => {
    setSortConfig((previous) => ({
      field,
      direction: previous.field === field ? (previous.direction === 'asc' ? 'desc' : 'asc') : 'asc',
    }));
  };

  const closeSidebar = () => setSelectedBand(null);

  const sortIndicator = (field: SortConfig['field']) => {
    if (sortConfig.field !== field) {
      return null;
    }

    return sortConfig.direction === 'asc' ? '▲' : '▼';
  };

  return (
    <div className="h-full w-full bg-slate-50 text-slate-900 flex flex-col overflow-hidden p-4 md:p-8">
      <div className="flex flex-col gap-6 h-full min-h-0">
        <header className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between pb-3 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <img src={logoDark} alt="Simnovus" className="h-7 w-auto object-contain" />
          </div>

          <div className="mt-0 xl:mt-0 xl:ml-3 xl:mr-auto min-w-0">
            <h1 className="text-lg font-semibold tracking-tight truncate">Band Information Tool</h1>
            <p className="text-xs text-slate-500 mt-0.5">Search and inspect NR or LTE band data.</p>
          </div>
        </header>



          <div className="flex flex-col gap-2 w-full">
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2 rounded border border-slate-200 bg-slate-50 px-2 py-1">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap">Freq (MHz)</span>
                <input
                  type="number"
                  value={filters.freqFrom}
                  onChange={(event) => updateFilter('freqFrom', event.target.value)}
                  placeholder="From"
                  className="w-20 rounded border border-slate-200 bg-white px-1 py-1 text-xs outline-none focus:border-blue-500"
                />
                <span className="text-slate-400">—</span>
                <input
                  type="number"
                  value={filters.freqTo}
                  onChange={(event) => updateFilter('freqTo', event.target.value)}
                  placeholder="To"
                  className="w-20 rounded border border-slate-200 bg-white px-1 py-1 text-xs outline-none focus:border-blue-500"
                />
              </div>
              <a
                href="/calculator"
                className="rounded border border-[#F27024] bg-[#F27024] px-3 py-1.5 text-sm font-medium text-white transition hover:bg-[#DD5F18] flex-shrink-0"
              >
                SSB Calculator
              </a>
            </div>

            <div className="flex flex-nowrap items-center gap-2 rounded-lg border border-orange-200 bg-white p-2 overflow-x-auto">
              <div className="relative flex-shrink-0">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-orange-300" />
                <input
                  type="text"
                  value={filters.search}
                  onChange={(event) => updateFilter('search', event.target.value)}
                  placeholder="Search"
                  className="rounded border border-orange-200 bg-white py-1.5 pl-8 pr-2 text-xs outline-none transition focus:border-[#F27024] focus:ring-2 focus:ring-orange-500/20 w-32"
                />
              </div>

              <div className="inline-flex rounded-md border border-orange-200 bg-orange-50 p-0.5 flex-shrink-0">
                {(['NR', 'LTE'] as Rat[]).map((rat) => (
                  <button
                    key={rat}
                    type="button"
                    onClick={() => {
                      setCurrentRat(rat);
                      setSelectedBand(null);
                    }}
                    className={`px-2 py-1 text-xs font-medium rounded-md transition-colors ${currentRat === rat ? 'bg-[#F27024] text-white shadow-sm' : 'text-orange-700 hover:bg-orange-100 hover:text-[#F27024]'}`}
                  >
                    {rat}
                  </button>
                ))}
              </div>

              <select
                className="rounded border border-[#F27024] bg-white pl-2 pr-1 py-1 text-xs text-[#F27024] outline-none focus:ring-2 focus:ring-orange-500/30 w-auto flex-shrink-0"
                value={filters.mode}
                onChange={(event) => updateFilter('mode', event.target.value)}
              >
                <option value="">Modes</option>
                {filterOptions.mode.map((mode) => (
                  <option key={mode} value={mode}>
                    {mode}
                  </option>
                ))}
              </select>

              <select
                className="rounded border border-[#F27024] bg-white pl-2 pr-1 py-1 text-xs text-[#F27024] outline-none focus:ring-2 focus:ring-orange-500/30 w-auto flex-shrink-0"
                value={filters.geoArea}
                onChange={(event) => updateFilter('geoArea', event.target.value)}
              >
                <option value="">Regions</option>
                {filterOptions.geoArea.map((region) => (
                  <option key={region} value={region}>
                    {region}
                  </option>
                ))}
              </select>

              <select
                className="rounded border border-[#F27024] bg-white pl-2 pr-1 py-1 text-xs text-[#F27024] outline-none focus:ring-2 focus:ring-orange-500/30 w-auto flex-shrink-0"
                value={filters.release}
                onChange={(event) => updateFilter('release', event.target.value)}
              >
                <option value="">Releases</option>
                {filterOptions.release.map((release) => (
                  <option key={release} value={release}>
                    {release}
                  </option>
                ))}
              </select>

              <select
                className="rounded border border-[#F27024] bg-white pl-2 pr-1 py-1 text-xs text-[#F27024] outline-none focus:ring-2 focus:ring-orange-500/30 w-auto flex-shrink-0"
                value={filters.supportedBandwidth}
                onChange={(event) => updateFilter('supportedBandwidth', event.target.value)}
              >
                <option value="">Bandwidths</option>
                {filterOptions.supportedBandwidth.map((bandwidth) => (
                  <option key={bandwidth} value={String(bandwidth)}>
                    {bandwidth} MHz
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={() => setFilters(INITIAL_FILTERS)}
                className="ml-auto rounded border border-[#F27024] bg-[#F27024] px-3 py-1 text-xs font-medium text-white transition hover:bg-[#DD5F18] flex-shrink-0"
              >
                Clear
              </button>
            </div>
          </div>

        <div className="relative flex-1 min-h-0 rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="h-full overflow-auto">
            <div className="w-full overflow-x-auto">
              <table className="min-w-max w-full text-left text-sm whitespace-nowrap">
              <thead className="sticky top-0 z-10 bg-slate-100 text-slate-500">
                <tr>
                  {[
                    ['band', 'Band'],
                    ['bandName', 'Band Name'],
                    ['mode', 'Mode'],
                    ['geoArea', 'Region'],
                    ['release', 'Release'],
                  ].map(([field, label]) => (
                    <th
                      key={field}
                      scope="col"
                      onClick={() => handleSort(field as SortConfig['field'])}
                      className={`select-none px-4 py-4 font-semibold cursor-pointer whitespace-nowrap transition hover:text-[#F27024] ${sortConfig.field === field ? 'text-[#F27024]' : ''}`}
                    >
                      <span className="inline-flex items-center gap-2">
                        {label}
                        <span className="text-[10px]">{sortIndicator(field as SortConfig['field'])}</span>
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredData.map((item) => (
                  <tr
                    key={`${item.rat}-${item.band}`}
                    className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer"
                    onClick={() => setSelectedBand(item)}
                  >
                    <td className="px-4 py-4">
                      <span className="inline-flex items-center rounded-full border border-orange-100 bg-orange-50 px-2.5 py-1 text-xs font-semibold text-orange-700">
                        {item.band}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-slate-900">{item.bandName}</td>
                    <td className="px-4 py-4">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${item.mode === 'FDD' ? 'bg-emerald-50 text-emerald-700' : item.mode === 'TDD' ? 'bg-blue-50 text-blue-700' : 'bg-violet-50 text-violet-700'}`}
                      >
                        {item.mode}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-slate-700">{item.geoArea || '—'}</td>
                    <td className="px-4 py-4 text-slate-700">{item.release || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
              </div>

            {filteredData.length === 0 && (
              <div className="flex items-center justify-center px-6 py-20 text-center text-slate-500">
                No bands matching your criteria were found.
              </div>
            )}
          </div>
        </div>
      </div>

      {selectedBand && (
        <>
          <button
            type="button"
            aria-label="Close details overlay"
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
            onClick={closeSidebar}
          />

          <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col overflow-hidden bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-6">
              <div>
                <div className="mb-2 flex flex-wrap gap-2">
                  <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                    {selectedBand.band}
                  </span>
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${selectedBand.mode === 'FDD' ? 'bg-emerald-50 text-emerald-700' : selectedBand.mode === 'TDD' ? 'bg-blue-50 text-blue-700' : 'bg-violet-50 text-violet-700'}`}
                  >
                    {selectedBand.mode}
                  </span>
                </div>
                <h2 className="text-xl font-bold tracking-tight">{selectedBand.bandName}</h2>
              </div>

              <button
                type="button"
                onClick={closeSidebar}
                className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                title="Close details"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              <section className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Region</p>
                  <p className="mt-1 text-base font-medium">{selectedBand.geoArea || 'Global'}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">3GPP Release</p>
                  <p className="mt-1 text-base font-medium">{selectedBand.release || '—'}</p>
                </div>
              </section>

              <section>
                <h3 className="mb-3 text-sm font-semibold text-slate-500 uppercase tracking-wider">Frequency Ranges (MHz)</h3>
                <div className="overflow-hidden rounded-xl border border-slate-200">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 text-slate-500">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold">Link</th>
                        <th className="px-3 py-2 text-left font-semibold">Low</th>
                        <th className="px-3 py-2 text-left font-semibold">Centre</th>
                        <th className="px-3 py-2 text-left font-semibold">High</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      <tr>
                        <td className="px-3 py-2 font-medium">DL</td>
                        <td className="px-3 py-2">{formatValue(selectedBand.dlFreqRange.low)}</td>
                        <td className="px-3 py-2">{formatValue(selectedBand.dlFreqRange.centre)}</td>
                        <td className="px-3 py-2">{formatValue(selectedBand.dlFreqRange.high)}</td>
                      </tr>
                      <tr>
                        <td className="px-3 py-2 font-medium">UL</td>
                        <td className="px-3 py-2">{formatValue(selectedBand.ulFreqRange.low)}</td>
                        <td className="px-3 py-2">{formatValue(selectedBand.ulFreqRange.centre)}</td>
                        <td className="px-3 py-2">{formatValue(selectedBand.ulFreqRange.high)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>

              <section>
                <h3 className="mb-3 text-sm font-semibold text-slate-500 uppercase tracking-wider">Channel Numbers</h3>
                <div className="overflow-hidden rounded-xl border border-slate-200">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 text-slate-500">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold">Link</th>
                        <th className="px-3 py-2 text-left font-semibold">Low</th>
                        <th className="px-3 py-2 text-left font-semibold">Centre</th>
                        <th className="px-3 py-2 text-left font-semibold">High</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      <tr>
                        <td className="px-3 py-2 font-medium">DL</td>
                        <td className="px-3 py-2">{formatValue(selectedBand.dlFreqRange.lowArfcn)}</td>
                        <td className="px-3 py-2">{formatValue(selectedBand.dlFreqRange.centreArfcn)}</td>
                        <td className="px-3 py-2">{formatValue(selectedBand.dlFreqRange.highArfcn)}</td>
                      </tr>
                      <tr>
                        <td className="px-3 py-2 font-medium">UL</td>
                        <td className="px-3 py-2">{formatValue(selectedBand.ulFreqRange.lowArfcn)}</td>
                        <td className="px-3 py-2">{formatValue(selectedBand.ulFreqRange.centreArfcn)}</td>
                        <td className="px-3 py-2">{formatValue(selectedBand.ulFreqRange.highArfcn)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>

              {selectedBand.scs.length > 0 && (
                <section>
                  <h3 className="mb-3 text-sm font-semibold text-slate-500 uppercase tracking-wider">Subcarrier Spacing (kHz)</h3>
                  <div className="flex flex-wrap gap-2">
                    {selectedBand.scs.map((spacing) => (
                      <span key={spacing} className="inline-flex items-center rounded-full border border-orange-100 bg-orange-50 px-2.5 py-1 text-xs font-semibold text-orange-700">
                        {spacing} kHz
                      </span>
                    ))}
                  </div>
                </section>
              )}

              {selectedBand.scsBandwidthCombination.length > 0 && (
                <section>
                  <h3 className="mb-3 text-sm font-semibold text-slate-500 uppercase tracking-wider">Supported Bandwidths</h3>
                  <div className="space-y-4">
                    {[...selectedBand.scsBandwidthCombination]
                      .sort((a, b) => a.scs - b.scs)
                      .map((combination) => (
                        <div key={combination.scs}>
                          {combination.scs > 0 && (
                            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">{combination.scs} kHz SCS</p>
                          )}
                          <div className="flex flex-wrap gap-2">
                            {combination.bandwidths.map((bandwidth) => (
                              <span key={bandwidth} className="inline-flex items-center rounded-full border border-orange-100 bg-orange-50 px-2.5 py-1 text-xs font-semibold text-orange-700">
                                {bandwidth} MHz
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                  </div>
                </section>
              )}
            </div>
          </aside>
        </>
      )}
    </div>
  );
}