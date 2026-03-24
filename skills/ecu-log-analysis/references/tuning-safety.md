# Tuning Safety

This reference defines evidence and reporting rules for tuning-oriented log
analysis.

It is not a replacement for the domain references. Use it to keep
recommendations disciplined when the diagnosis is uncertain, the operating
condition is hazardous, or repeated changes are not converging.

## Core Rule

Separate hazard severity from confidence in the diagnosis.

A condition can be dangerous while the current hypothesis about its cause
remains weak. State both independently.

## Evidence Threshold

Do not treat one log, one symptom, or one apparent correlation as proof of a
single root cause.

Before recommending calibration changes, establish as much of the following as
possible:

- hardware configuration
- ROM provenance
- recent changes made before the issue appeared
- stock or known-good reference files, if available
- stable logs from the operating region relevant to the issue

If these are missing, say so and lower confidence accordingly.

## Baseline First

When a stock ROM, known-good ROM, or known-good log is available, compare early
instead of after many iterative adjustments.

## Non-Convergence Rule

If repeated adjustments do not move the system toward the expected outcome,
change diagnostic strategy instead of repeating the same class of intervention.

Examples:

- repeated wastegate or WGDC changes without expected boost response
- repeated MAF tweaks without trim convergence
- repeated idle changes with only marginal or contradictory improvement

At that point, gather missing hardware context, compare against baseline, and
branch into alternate hypotheses.

## Single-Variable Warning

Do not assume the observed problem is caused by the table currently being
edited.

Before recommending a calibration change, consider whether the issue may be
better explained by:

- incorrect hardware assumptions
- injector characterization
- compensations or limits
- sensor scaling or sensor faults
- fallback behavior
- plumbing or mechanical faults
- exhaust back pressure or leakage

If multiple explanations remain plausible, report that explicitly.

## Change Magnitude Guidance

Prefer small, reviewable, iterative recommendations unless the evidence is
unusually strong and consistent.

Avoid:

- large table-wide changes from sparse evidence
- aggressive extrapolation into unsupported regions
- presenting first-pass corrections as final values

## Reporting Rules

When presenting findings, include:

1. current hypothesis
2. confidence in that hypothesis
3. why the condition may be hazardous, if relevant
4. what evidence supports the diagnosis
5. what evidence is missing
6. what observation would confirm or falsify the current hypothesis
7. the next recommended action

## Language Guidance

Prefer language like:

- `hazard: high, diagnosis confidence: low`
- `suggested correction`
- `requires confirmation`
- `insufficient support for a confident change`
- `current hypothesis does not explain all observations`

Avoid turning hazard warnings into certainty about the root cause.

## Refusal Conditions

Do not present confident calibration recommendations when:

- the system is behaving dangerously and the cause is still unclear
- repeated interventions have not converged
- the ROM provenance or hardware configuration is unknown and likely relevant
- the available logs do not cover the correct operating region

In those cases, prefer:

- collecting missing context
- comparing against stock or known-good references
- switching from calibration-only reasoning to broader diagnosis
