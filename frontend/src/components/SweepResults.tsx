import { useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from 'primereact/button';
import { Message } from 'primereact/message';
import { Tag } from 'primereact/tag';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronRight } from '@fortawesome/free-solid-svg-icons';
import { useGet } from '../functions/axios';
import { STATUS_SEVERITY } from '../functions/statusSeverity';
import type { BatchResults, BatchRun } from '../types/metrics';
import type { SweepVariable } from '../types/simulation';
import { SWEEP_VARIABLE_OPTIONS } from '../schemas/simulationForm';
import LineChart, { type LineChartPoint } from './LineChart';
import LoadingScreen from './LoadingScreen';
import backgroundImage from '../assets/Background.png';

function sweptValue(run: BatchRun, variable: SweepVariable): number {
  switch (variable) {
    case 'arrivalRatePerHour':
      return run.arrivalRatePerHour;
    case 'departureRatePerHour':
      return run.departureRatePerHour;
    case 'durationMinutes':
      return run.durationMinutes;
    case 'maxWaitMinutes':
      return run.maxWaitMinutes;
  }
}

const formatCount = (value: number) => Math.round(value).toLocaleString();
const formatPercent = (value: number) => `${Math.round(value)}%`;
const formatMinutes = (value: number) => `${value.toFixed(1)}m`;

/** Rounds to the same precision the value is displayed at. Without this, two
 * points that render identical labels (e.g. both "0.0m") can still carry
 * different raw floating-point values (float division noise, or a genuinely
 * tiny-but-nonzero average) — and since the chart's Y domain scales off the
 * raw values, one of those "identical-looking" points ends up plotted at a
 * wildly different height, reading as a spike in an otherwise flat line. */
const roundTo = (value: number, decimals: number) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

/** Successful completions per hour — this is what actually saturates as
 * demand climbs, unlike raw aircraft generated. */
const throughputFor = (run: BatchRun): number | null =>
  run.durationMinutes > 0 ? roundTo((run.outcomeCounts.success / run.durationMinutes) * 60, 0) : null;

export default function SweepResults() {
  const navigate = useNavigate();
  const { batchId } = useParams<{ batchId: string }>();
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const { data, loading, error } = useGet<BatchResults>(
    batchId ? `/api/simulations/batch/?id=${batchId}` : null,
  );

  const backButton = (
    <Button
      icon="pi pi-chevron-left"
      aria-label="Back to home"
      onClick={() => navigate('/')}
      className="self-start"
    />
  );

  const shell = (content: ReactNode) => (
    <div className="-m-6 h-[calc(100%+3rem)] flex flex-col">
      <div
        className="relative flex-1 min-h-0 overflow-x-auto overflow-y-hidden p-4 sm:p-10 flex items-center justify-center"
        style={{
          backgroundImage: `url(${backgroundImage})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
        }}
      >
        <div
          className="queue-scroll relative flex min-w-[800px] flex-col gap-4 overflow-y-auto rounded-lg border-2 border-black bg-white p-4 shadow-2xl sm:p-6"
          style={{ width: '100%', maxWidth: '1600px', maxHeight: '100%', aspectRatio: '1.5' }}
        >
          {content}
        </div>
      </div>
    </div>
  );

  const header = (
    <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3">
      {backButton}
      <h1 className="text-center text-2xl font-bold uppercase tracking-wide text-slate-900">
        Sweep Results
      </h1>
      <span aria-hidden className="w-10" />
    </div>
  );

  if (loading) {
    return <LoadingScreen />;
  }

  if (error || !data) {
    return shell(
      <>
        {header}
        <Message severity="error" text="Failed to load this sweep's results." />
      </>,
    );
  }

  const variable = data.sweptVariable;
  const variableLabel =
    SWEEP_VARIABLE_OPTIONS.find((option) => option.value === variable)?.label ?? variable;

  if (!variable) {
    return shell(
      <>
        {header}
        <Message
          severity="info"
          text="This batch has no recorded swept variable, so there's nothing to chart."
        />
      </>,
    );
  }

  const sortedRuns = [...data.simulations].sort(
    (a, b) => sweptValue(a, variable) - sweptValue(b, variable),
  );
  const completeRuns = sortedRuns.filter((run) => run.status === 'Complete');

  const xPoints = completeRuns.map((run) => sweptValue(run, variable));
  const successRatePoints: LineChartPoint[] = completeRuns.map((run, i) => ({
    x: xPoints[i],
    y: roundTo(run.successRate, 0),
  }));
  const avgWaitPoints: LineChartPoint[] = completeRuns.map((run, i) => ({
    x: xPoints[i],
    y:
      run.waitTimeStats.averageMinutes != null
        ? roundTo(run.waitTimeStats.averageMinutes, 1)
        : null,
  }));
  const throughputPoints: LineChartPoint[] = completeRuns.map((run, i) => ({
    x: xPoints[i],
    y: throughputFor(run),
  }));

  return shell(
    <>
      {header}
      <p className="text-center text-sm text-slate-600">
        Swept variable: <span className="font-semibold">{variableLabel}</span>
      </p>

      {completeRuns.length >= 2 ? (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
          <LineChart
            title="Success Rate"
            color="#008300"
            points={successRatePoints}
            hoveredIndex={hoveredIndex}
            onHoverIndex={setHoveredIndex}
            xTickFormat={formatCount}
            yTickFormat={formatPercent}
            valueFormat={formatPercent}
          />
          <LineChart
            title="Avg Wait Time"
            color="#e87ba4"
            points={avgWaitPoints}
            hoveredIndex={hoveredIndex}
            onHoverIndex={setHoveredIndex}
            xTickFormat={formatCount}
            yTickFormat={formatMinutes}
            valueFormat={formatMinutes}
          />
          <LineChart
            title="Throughput (successful ops/hr)"
            color="#2a78d6"
            points={throughputPoints}
            hoveredIndex={hoveredIndex}
            onHoverIndex={setHoveredIndex}
            xTickFormat={formatCount}
            yTickFormat={formatCount}
            valueFormat={formatCount}
          />
        </div>
      ) : (
        <Message
          severity="warn"
          text="At least 2 runs in this sweep must be Complete before a curve can be drawn."
        />
      )}

      <div className="overflow-x-auto rounded border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-brand-bg text-slate-700">
            <tr>
              <th className="p-2 text-left">{variableLabel}</th>
              <th className="p-2 text-left">Status</th>
              <th className="p-2 text-right">Success Rate</th>
              <th className="p-2 text-right">Avg Wait (mins)</th>
              <th className="p-2 text-right">Throughput (ops/hr)</th>
              <th className="p-2" />
            </tr>
          </thead>
          <tbody>
            {sortedRuns.map((run) => {
              const index = completeRuns.indexOf(run);
              const throughput = run.status === 'Complete' ? throughputFor(run) : null;
              return (
                <tr
                  key={run.id}
                  onClick={() => navigate(`/simulation/${run.id}/detail`)}
                  className={`cursor-pointer hover:bg-brand-bg ${
                    index !== -1 && index === hoveredIndex ? 'bg-brand-bg' : ''
                  }`}
                >
                  <td className="p-2">{sweptValue(run, variable)}</td>
                  <td className="p-2">
                    <Tag value={run.status} severity={STATUS_SEVERITY[run.status]} />
                  </td>
                  <td className="p-2 text-right">
                    {run.status === 'Complete' ? formatPercent(run.successRate) : '—'}
                  </td>
                  <td className="p-2 text-right">
                    {run.status === 'Complete' && run.waitTimeStats.averageMinutes != null
                      ? formatMinutes(run.waitTimeStats.averageMinutes)
                      : '—'}
                  </td>
                  <td className="p-2 text-right">
                    {throughput != null ? formatCount(throughput) : '—'}
                  </td>
                  <td className="p-2 text-right text-brand-accent-active">
                    <FontAwesomeIcon icon={faChevronRight} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>,
  );
}
