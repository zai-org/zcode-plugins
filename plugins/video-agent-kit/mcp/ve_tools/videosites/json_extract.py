"""Extract embedded JSON from source pages."""
import json

def grab_json(h: str, key: str) -> dict | None:
    i = h.find(key)
    if i < 0:
        return None
    j = h.find("{", i)
    depth, instr, esc = 0, False, False
    for k in range(j, len(h)):
        c = h[k]
        if instr:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == '"':
                instr = False
        else:
            if c == '"':
                instr = True
            elif c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(h[j:k + 1])
                    except Exception:
                        return None
    return None
