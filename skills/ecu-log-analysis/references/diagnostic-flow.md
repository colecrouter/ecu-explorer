# Diagnostic Flow

This reference defines a general troubleshooting process for tuning-oriented
problems.

Use it when:

- the problem is not yet clearly categorized
- multiple hypotheses are plausible
- repeated adjustments are not converging
- the user is asking for diagnosis, not just a table calculation

## Core Rule

Gather the highest-value missing context before iterating deeper on a weak
hypothesis.

Do not treat every new log or minor symptom change as justification to keep
adjusting the same thing.

## First Questions

Before recommending changes, try to establish:

- what hardware is installed
- what changed immediately before the problem appeared
- whether the ROM is stock, modified, or of unknown origin
- whether stock or known-good references are available
- whether the log covers the operating region where the problem occurs

## Baseline Comparison

When baseline material is available, compare early:

- stock ROM versus current ROM
- known-good log versus problem log
- expected hardware specs versus installed hardware

This is especially valuable when:

- the tune came from an unknown source
- the user inherited the ROM
- the observed behavior is broad or inconsistent
- table-by-table tweaking is not converging

## External Research

When hardware details, specs, or common failure modes are unclear, use
the web deliberately to reduce uncertainty.

Useful targets include:

- hardware specs and manufacturer documentation
- known actuator, injector, turbo, or sensor reference values
- common complaints or failure reports for the exact hardware
- forum or community discussion of recurring platform-specific issues
- stock or known-good calibration references, when publicly available

Use external research to answer specific missing questions, not as a substitute
for local evidence.

## Hypothesis Workflow

Use this default sequence:

1. define the symptom precisely
2. gather missing hardware, ROM, and log context
3. compare against baseline if available
4. generate a short list of plausible causes
5. choose the highest-value next test or check
6. update confidence based on whether the new evidence moves the diagnosis

Keep the active hypothesis list short. If the current leading explanation does
not account for the major observations, say so explicitly.

## Change-of-Strategy Trigger

Stop repeating the same class of intervention when:

- multiple iterations do not move the result toward the expected outcome
- the response is weaker or opposite to what the hypothesis predicts
- the system behavior suggests a hidden mechanical or configuration issue
- new evidence conflicts with the current explanation

At that point:

1. lower confidence in the current hypothesis
2. gather the next missing piece of context
3. compare against stock or known-good data if possible
4. branch into a different category of cause

## Good Next Questions

Examples of high-value questions:

- What turbo, injectors, MAF, or fuel system parts are installed?
- Is this ROM stock, self-tuned, or from another person?
- Do you have the stock ROM or a known-good ROM?
- Do you have a log from before the issue began?
- What exact operating condition triggers the problem?
- What changed immediately before the issue appeared?

Ask questions that reduce uncertainty materially, not just questions that are
generally interesting.

## Refusal Conditions

Do not keep proposing incremental table changes when:

- the system-wide baseline is still unknown
- the ROM provenance is likely relevant and unresolved
- the available logs do not cover the failure mode clearly
- repeated adjustments have not converged

In those cases, pivot to context gathering, baseline comparison, or a different
diagnostic branch.
