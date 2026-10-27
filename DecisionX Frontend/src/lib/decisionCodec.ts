/**
 * DecisionX contract codec.
 *
 * Single source of truth for translating between the frontend form/state and the
 * on-chain `DecisionX` ABI:
 *   - `CreateDecisionParams` struct (createDecision input)
 *   - `getDecision` return tuple (core, meta, options, pools)
 *   - `getUserPosition` return tuple (stakesByOption, totalUserStake, claimed)
 *
 * Kept free of React and JSON imports so it can be exercised directly by the
 * Node test suite (`test/frontend-codec.test.mjs`).
 */
import { isAddress } from 'ethers';

export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 8;
const SECONDS_PER_DAY = 86400;

export const DEFAULT_DESCRIPTION = 'On-chain parimutuel decision market';
export const DEFAULT_ORG = 'BOT Chain Community';
export const DEFAULT_METRIC = 'Verified on-chain outcome criteria';

/** Raw values collected by the Create Decision wizard. */
export type CreateDecisionForm = {
  title: string;
  org: string;
  description: string;
  options: string[];
  metricName: string;
  metricMethod: string;
  forecastDays: string;
  resolutionDays: string;
  resolverAddress: string;
};

/** Mirrors `DecisionX.CreateDecisionParams` field-for-field. */
export type CreateDecisionParams = {
  title: string;
  organization: string;
  metric: string;
  criteriaUriOrHash: string;
  options: string[];
  forecastCutoff: bigint;
  resolutionDeadline: bigint;
  resolver: string;
};

export type FormValidationError = {
  /** Wizard step (1-based) the user should be sent back to. */
  step: number;
  message: string;
};

/**
 * Validates the wizard form so obvious mistakes are caught before the wallet
 * prompt (and before any gas is spent on a reverting transaction).
 */
export function validateCreateDecisionForm(
  form: CreateDecisionForm,
  fallbackResolver: string | null,
): FormValidationError | null {
  if (!form.title.trim()) {
    return { step: 1, message: 'Decision title is required.' };
  }
  if (!form.org.trim()) {
    return { step: 1, message: 'Organization or DAO name is required.' };
  }

  const options = form.options.map((o) => o.trim());
  if (options.length < MIN_OPTIONS || options.length > MAX_OPTIONS) {
    return { step: 2, message: `A decision needs between ${MIN_OPTIONS} and ${MAX_OPTIONS} options.` };
  }
  if (options.some((o) => !o)) {
    return { step: 2, message: 'Every option needs a name.' };
  }
  const unique = new Set(options.map((o) => o.toLowerCase()));
  if (unique.size !== options.length) {
    return { step: 2, message: 'Options must be distinct.' };
  }

  const forecastDays = Number(form.forecastDays);
  const resolutionDays = Number(form.resolutionDays);
  if (!Number.isInteger(forecastDays) || forecastDays < 1) {
    return { step: 4, message: 'Forecast window must be a whole number of days (minimum 1).' };
  }
  if (!Number.isInteger(resolutionDays) || resolutionDays < forecastDays) {
    return { step: 4, message: 'Resolution deadline must be on or after the forecast window closes.' };
  }

  const resolver = form.resolverAddress.trim() || fallbackResolver || '';
  if (!isAddress(resolver)) {
    return { step: 4, message: 'Designated resolver must be a valid wallet address.' };
  }
  if (/^0x0{40}$/i.test(resolver)) {
    return { step: 4, message: 'Designated resolver cannot be the zero address.' };
  }

  return null;
}

/** Packs free-form description + resolution criteria into `criteriaUriOrHash`. */
export function encodeCriteria(description: string, criteria: string): string {
  const d = description.trim();
  const c = criteria.trim();
  if (!d && !c) return '';
  return JSON.stringify({ description: d, criteria: c });
}

/**
 * Reverses `encodeCriteria`. Plain URIs / hashes (e.g. decisions created by
 * scripts) are returned as `criteria` with no description.
 */
export function decodeCriteria(raw: string | null | undefined): { description: string; criteria: string } {
  const value = (raw ?? '').trim();
  if (value.startsWith('{')) {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object') {
        return {
          description: typeof parsed.description === 'string' ? parsed.description : '',
          criteria: typeof parsed.criteria === 'string' ? parsed.criteria : '',
        };
      }
    } catch {
      // fall through and treat as an opaque string
    }
  }
  return { description: '', criteria: value };
}

/** Builds the exact struct expected by `DecisionX.createDecision`. */
export function buildCreateDecisionParams(
  form: CreateDecisionForm,
  fallbackResolver: string,
  nowSeconds: number,
): CreateDecisionParams {
  const forecastDays = parseInt(form.forecastDays, 10);
  const resolutionDays = parseInt(form.resolutionDays, 10);
  const now = BigInt(Math.floor(nowSeconds));

  return {
    title: form.title.trim(),
    organization: form.org.trim(),
    metric: form.metricName.trim(),
    criteriaUriOrHash: encodeCriteria(form.description, form.metricMethod),
    options: form.options.map((o) => o.trim()),
    forecastCutoff: now + BigInt(forecastDays * SECONDS_PER_DAY),
    resolutionDeadline: now + BigInt(resolutionDays * SECONDS_PER_DAY),
    resolver: form.resolverAddress.trim() || fallbackResolver,
  };
}

/** Normalized view of a `getDecision` result. */
export type ParsedDecision = {
  creator: string;
  resolver: string;
  createdAt: number;
  forecastCutoff: number;
  resolutionDeadline: number;
  winningOption: number;
  statusCode: number;
  totalPoolRaw: bigint;
  title: string;
  org: string;
  description: string;
  metric: string;
  criteria: string;
  evidenceUri: string;
  options: { index: number; name: string; poolRaw: bigint; percent: number }[];
};

type Numeric = bigint | number | string;

/** Shape of an ethers `Result` from `getDecision` (named access). */
export type RawDecisionResult = {
  core: {
    creator: string;
    createdAt: Numeric;
    optionCount: Numeric;
    resolver: string;
    forecastCutoff: Numeric;
    winningOption: Numeric;
    resolutionDeadline: Numeric;
    status: Numeric;
    totalPool: Numeric;
  };
  meta: {
    title: string;
    organization: string;
    metric: string;
    criteriaUriOrHash: string;
    evidenceUri: string;
  };
  options: ArrayLike<string>;
  pools: ArrayLike<Numeric>;
};

export function parseDecisionResult(id: number, raw: RawDecisionResult): ParsedDecision {
  const { core, meta } = raw;
  const totalPoolRaw = BigInt(core.totalPool.toString());
  const optionCount = Number(core.optionCount);
  const { description, criteria } = decodeCriteria(meta.criteriaUriOrHash);

  const options: ParsedDecision['options'] = [];
  for (let i = 0; i < optionCount; i++) {
    const poolRaw = BigInt((raw.pools[i] ?? 0).toString());
    let percent = optionCount > 0 ? 100 / optionCount : 0;
    if (totalPoolRaw > 0n) {
      percent = Number((poolRaw * 10000n) / totalPoolRaw) / 100;
    }
    options.push({ index: i, name: raw.options[i] ?? `Option ${i + 1}`, poolRaw, percent });
  }

  return {
    creator: core.creator,
    resolver: core.resolver,
    createdAt: Number(core.createdAt),
    forecastCutoff: Number(core.forecastCutoff),
    resolutionDeadline: Number(core.resolutionDeadline),
    winningOption: Number(core.winningOption),
    statusCode: Number(core.status),
    totalPoolRaw,
    title: meta.title || `Decision #${id}`,
    org: meta.organization || DEFAULT_ORG,
    description: description || DEFAULT_DESCRIPTION,
    metric: meta.metric || DEFAULT_METRIC,
    criteria,
    evidenceUri: meta.evidenceUri,
    options,
  };
}

/** Normalized view of a `getUserPosition` result. */
export function parseUserPositionResult(raw: {
  stakesByOption: ArrayLike<Numeric>;
  totalUserStake: Numeric;
  claimed: boolean;
}): { stakesByOption: bigint[]; totalUserStake: bigint; claimed: boolean } {
  return {
    stakesByOption: Array.from(raw.stakesByOption, (v) => BigInt(v.toString())),
    totalUserStake: BigInt(raw.totalUserStake.toString()),
    claimed: Boolean(raw.claimed),
  };
}
