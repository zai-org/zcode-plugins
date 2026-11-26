# Domains

A domain is one area of user-visible behaviour with one owner file:
`spec/domains/<domain>.md`. The domain file is the behaviour truth; the code is
only the current implementation of what that file says.

## Rules

- One file per domain. The file name is the domain slug in lower case and the
  same slug appears in feature-point IDs (`F-<DOMAIN>-01`).
- A feature point must exist in its domain file and in `spec/INDEX.md` before
  it is implemented. Both must agree; one without the other is not a feature
  point.
- Describe behaviour, not code: goal, trigger, observable result, failure
  behaviour, and how a person can prove it.
- Every entry carries an `impl` pointer to the files that implement it. The
  pointer is part of the contract: move the implementation and update the
  pointer in the same change.
- When the code and the domain file disagree, the domain file is the truth
  until a reviewed change updates it. Treating the code as the truth is how a
  behaviour change becomes silent.
- A domain file with no feature points is a placeholder: add its first entry
  when the first feature point exists, or delete the file.

## Entry format

Copy this block for each feature point:

```markdown
## F-<DOMAIN>-01 — <feature point>

- goal: <user-visible outcome>
- trigger: <what starts the behaviour>
- behaviour: <observable result>
- failure: <what happens when it cannot complete>
- acceptance: <one command or observable result with an unambiguous pass/fail>
- impl: `<path/to/implementing/file>` (and companion files)
```

An entry is not a feature point until its acceptance line is testable.
