# MAF Scaling Workflow

This reference describes how to structure MAF-scaling analysis from logs without
assuming one specific logger, ECU family, or channel naming convention.

The goal is not to force a result from every log. The goal is to determine
whether a log is suitable, normalize it into a common tuning model, and only
then propose conservative next steps.

## Core Rule

Do not recommend MAF scaling changes until the required concepts are identified
with reasonable confidence and the log is shown to be valid for the intended
analysis mode.

## Required Truths

Before proposing scaling changes, determine:

1. whether the ECU is likely using MAF-derived fueling or load in the region being analyzed
2. whether the log contains the channels needed for a valid method
3. whether the data quality is good enough to support recommendations
4. whether the MAF table domain can be related back to the observed data

If any of these remain unclear, stop and report the uncertainty instead of
guessing.

## Canonical Concepts

Map source channels into canonical concepts before reasoning about tuning.

Common canonical concepts:

- time
- RPM
- throttle or accelerator input
- load
- MAF voltage, frequency, or airflow
- manifold pressure / boost / MAP
- short-term fuel trim
- long-term fuel trim
- commanded lambda or AFR
- measured lambda or AFR
- coolant temperature
- closed-loop / open-loop state, if available

The channel names do not need to match these labels exactly. What matters is the
concept, unit, and confidence of the mapping.

## Analysis Modes

Choose the method based on the evidence the log actually provides.

### Trim-Based Mode

Use when:

- the relevant fueling region is in closed loop
- short-term and long-term trim information is available
- the log is stable enough to treat trims as meaningful

Best suited for low and moderate load regions, not as a universal method for
all operating conditions.

### Wideband-Based Mode

Use when:

- commanded and measured lambda or AFR are both available
- the logged region is appropriate for open-loop analysis
- the data is stable enough to compare measured fueling against target fueling

Best suited for regions where trim-based reasoning is not appropriate.

### Refuse / Insufficient Data

Use when:

- MAF participation in fueling cannot be established
- channel mapping is too uncertain
- the log is mostly idle, decel, or transient behavior
- the necessary trim or wideband concepts are missing
- sample density is too poor to support a recommendation

## Correction Equations

The equations are simple. The hard part is deciding when they are valid and how
to aggregate them into a usable curve.

### Trim-Based Correction

For closed-loop regions, a practical correction estimate is based on total fuel
trim:

`total_trim_pct = stft_pct + ltft_pct`

`raw_correction_factor = 1 + (total_trim_pct / 100)`

`raw_correction_pct = total_trim_pct`

Interpretation:

- positive trim means the ECU is adding fuel, which usually implies the current
  MAF value is too low in that region
- negative trim means the ECU is removing fuel, which usually implies the
  current MAF value is too high in that region

When expressing the recommendation as a direct MAF table adjustment, the usual
closed-loop first-pass assumption is:

`new_maf_value = old_maf_value * raw_correction_factor`

### Wideband-Based Correction

For open-loop regions, use commanded versus measured fueling error.

Lambda form:

`raw_correction_factor = measured_lambda / commanded_lambda`

`raw_correction_pct = ((measured_lambda / commanded_lambda) - 1) * 100`

AFR form:

`raw_correction_factor = commanded_afr / measured_afr`

`raw_correction_pct = ((commanded_afr / measured_afr) - 1) * 100`

These are equivalent when AFRs are on the same fuel scale. Use lambda when
possible because it avoids fuel-specific AFR ambiguity.

Interpretation:

- if measured lambda is greater than commanded lambda, the engine is leaner
  than target and MAF usually needs to increase in that region
- if measured lambda is less than commanded lambda, the engine is richer than
  target and MAF usually needs to decrease in that region

### Notes on Variants

- Some ECUs expose trims in percent already. Others require combining multiple
  learned trims or selecting a trim bucket.
- Some workflows model correction as injector or VE error first, then translate
  that into MAF correction.
- The equations above are the direct agent-facing form to use unless the ECU
  strategy clearly requires a different interpretation.

## ECU-Specific Caveats

Do not assume that the same-looking channels mean the same thing on every ECU.
Before relying on the equations above, verify the following:

- trim meaning and sign:
  confirm whether the exposed trim channels are true percentages, how they are
  combined, and whether positive trim means fuel is being added
- fueling mode validity:
  confirm that the region being analyzed is actually suitable for trim-based or
  wideband-based reasoning
- MAF participation:
  confirm that MAF is a trusted fueling or load input in the region being analyzed
- table domain mapping:
  confirm whether the ROM uses MAF voltage, frequency, or another intermediate
  representation, and map bins accordingly
- compensation interference:
  check whether injector scaling, latency, pressure compensation, temperature
  compensation, or learned corrections are more likely to explain the error
- bank and sensor layout:
  on engines with multiple banks or sensors, confirm whether the observed error
  is global or bank-specific
- fallback or fault behavior:
  confirm that the ECU is not substituting, clamping, or ignoring sensor input
  in a way that invalidates the analysis

If these cannot be established with reasonable confidence, stop and report the
uncertainty instead of presenting precise correction values.

## Aggregation and Fitting

Do not apply raw per-sample corrections directly to the table. Aggregate them by
the MAF table domain and then fit a conservative recommendation.

### Per-Bin Aggregation

Bin samples by the axis that corresponds to the actual MAF table:

- MAF voltage if the ROM uses voltage-based scaling
- MAF frequency if the ROM uses frequency-based scaling
- observed MAF domain only as a fallback when the true table axis is not yet available

For each bin, compute:

- sample count
- raw correction mean or median
- spread or variability
- confidence level

Prefer median or a trimmed mean when the data is noisy.

### Fitting Policy

After per-bin aggregation:

1. reject bins with too few samples or very high spread
2. preserve strongly supported local features
3. smooth jagged cell-to-cell noise
4. cap change magnitude for a single pass
5. avoid confident extrapolation into sparse regions

Do not force one curve-fitting method in the skill. Acceptable options include:

- light smoothing of adjacent bins
- shape-preserving interpolation
- constrained polynomial or spline fitting
- leaving unsupported regions unchanged

The method matters less than the policy: preserve supported shape, reduce noise,
and avoid introducing artificial spikes.

## Algorithm Shape

Use this as the default agent workflow:

```text
1. Map source channels into canonical concepts.
2. Determine whether MAF is active in the region being analyzed.
3. Select trim-based, wideband-based, or refuse.
4. Reject invalid samples based on stability and quality gates.
5. Map valid samples into MAF-domain bins.
6. Compute raw correction per sample using the appropriate equation.
7. Aggregate corrections per bin.
8. Reject sparse or inconsistent bins.
9. Smooth or fit conservatively.
10. Emit reviewable recommendations with confidence and refusal notes where needed.
```

## Data Quality Gates

Treat the log as unsuitable or lower-confidence when it is dominated by:

- cold start or warmup enrichment
- idle control behavior
- throttle tip-in or tip-out
- rapid load or RPM transients
- decel fuel cut
- obvious sensor failures, fallback strategies, or implausible values
- too few samples in the regions of interest

The agent should prefer refusing over producing precise-looking but unsupported
recommendations.

## MAF Usability Assessment

Assess MAF usability separately from the correction method.

Questions to answer:

1. Is MAF materially participating in fueling or load in this region?
2. Is this region valid for trim-based correction?
3. Is this region valid for wideband-based correction?
4. Are the results likely to map back to the actual MAF table domain?

Possible outcomes:

- `MAF active: likely`
- `MAF active: uncertain`
- `MAF active: unlikely`
- `trim-based analysis: valid`
- `wideband-based analysis: valid`
- `analysis: insufficient data`

## Output Schema

Prefer emitting a structured result that separates raw evidence from the final
recommendation.

Example shape:

```json
{
  "analysis_mode": "trim_based",
  "maf_domain": "voltage",
  "maf_active": "likely",
  "bins": [
    {
      "x": 1.24,
      "samples": 42,
      "raw_correction_pct": 3.1,
      "fit_correction_pct": 2.4,
      "confidence": "high"
    }
  ],
  "notes": [
    "insufficient support above 4.2 V",
    "idle region excluded"
  ]
}
```

## Output Shape

When reporting findings, prefer a structured summary:

1. channel mapping summary
2. analysis mode selected
3. rejected samples or regions and why
4. confidence level
5. conservative recommendation or refusal

If you propose changes, keep them framed as reviewable recommendations, not
authoritative final values.

## Refusal Conditions

Refuse to provide correction values when:

- the required concepts are missing
- channel mapping confidence is low
- the log shape is too ambiguous to interpret reliably
- the operating region is not suitable for the chosen method
- the relationship back to the ROM's MAF table cannot be established

In that case, say what additional data or context would unblock the analysis.
