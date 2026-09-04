#!/usr/bin/env bash
# zCoder — always-on routing hooks (ZCode). Registered for three events:
#   SessionStart (startup/resume/clear/compact) → anchor the routing protocol at chat boot
#   UserPromptSubmit                            → routing directive on every prompt
#   PreToolUse (Agent)                          → dispatch-contract check on glm engine dispatches
# Exit 0 with stdout -> context. Kill switches: touch ~/.zcode/zcoder.off
# or export GLM_ORCHESTRATOR_DISABLE=1.

payload=$(cat 2>/dev/null)

if [ -f "$HOME/.zcode/zcoder.off" ] || [ -n "$GLM_ORCHESTRATOR_DISABLE" ]; then
  exit 0
fi

routing_block() {
  cat <<'EOF'
<zcoder-routing>
Route by ordered predicates; first match wins. (1) Atomic request — one deliverable, one input type, small scope — answer directly on the main thread; never dispatch for what you can answer now. (2) A sub-task needs an image/screenshot/diagram → glm-vision = GLM-5.3-Flash for that sub-task (single-glance lookup — one image, ≤5 items, nothing else in flight: read the image yourself instead — same model). (3) Mechanical items beyond that — a batch of independent fully-specified items (format, boilerplate, JSON/YAML, renames, docstrings) or one bulk item — → ONE glm-turbo batch IF glm-turbo has a verified PASS this session, else a main-thread mechanical batch: never route real work to an unverified engine. (4) Deep sub-task (cross-file logic, algorithms, unclear-cause debugging) → glm-main = GLM-5.3 only when it runs parallel to other engine work or needs isolated context — the main thread runs the same model at max effort. If glm-vision fails, perception degrades to the main thread first, then glm-main. The first dispatch of an engine is its preflight: config errors are free, instant, and never retried; transient failures retry once, then degrade. Dispatch independent sub-tasks in parallel. Full protocol: glm-orchestrator skill.
</zcoder-routing>
EOF
}

dispatch_check() {
  cat <<'EOF'
<zcoder-dispatch-check>
zCoder dispatch contract: the message must be self-contained (engines cannot see the orchestrator's conversation) — task, file/image paths, constraints, expected output; ≤300 words; never inline file contents the engine can Read itself; batch independent mechanical items into one glm-turbo dispatch; glm-main only when parallel with other engines or isolated context is needed. If this dispatch violates the contract, revise it; otherwise proceed unchanged.
</zcoder-dispatch-check>
EOF
}

case "$payload" in
  *'"hook_event_name":"SessionStart"'*|*'"hook_event_name": "SessionStart"'*)
    routing_block
    ;;
  *'"hook_event_name":"PreToolUse"'*|*'"hook_event_name": "PreToolUse"'*)
    case "$payload" in
      *glm-vision*|*glm-turbo*|*glm-main*)
        dispatch_check
        ;;
      *)
        # Non-zCoder agent dispatch (Explore, general-purpose, ...): stay silent.
        ;;
    esac
    ;;
  *)
    # UserPromptSubmit (and any payload without an event name): routing directive.
    routing_block
    ;;
esac

exit 0
