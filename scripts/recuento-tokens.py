"""Recuento independiente de tokens de sesiones de Claude Code (criterio de aceptación).

    python scripts/recuento-tokens.py <carpeta projects/> [--json]

No comparte código con el parser de la app: si los dos coinciden, el cálculo es fiable.
Reglas:
  - un evento por mensaje del asistente, clave `message.id:requestId`;
  - si la clave se repite, máximo de cada contador;
  - fuera los mensajes sin `message.id` y los de modelo `<synthetic>`;
  - el total de una sesión incluye sus subagentes; el total global deduplica entre todos los archivos;
  - uso propio: si A tiene `continued-in` hacia B (mismo proyecto), lo que B comparte con A no es de B.
Solo lee.
"""

import json
import os
import sys

FIELDS = (
    ("input", "input_tokens"),
    ("output", "output_tokens"),
    ("cacheCreation", "cache_creation_input_tokens"),
    ("cacheRead", "cache_read_input_tokens"),
)


def continued_in(path):
    target = None
    with open(path, encoding="utf-8", errors="replace") as fh:
        for raw in fh:
            if '"continued-in"' not in raw:
                continue
            try:
                obj = json.loads(raw)
            except ValueError:
                continue
            if isinstance(obj, dict) and obj.get("type") == "continued-in":
                target = obj.get("continuedInSessionId") or target
    return target


def events(path):
    out = {}
    with open(path, encoding="utf-8", errors="replace") as fh:
        for raw in fh:
            if not raw.endswith("\n"):
                break  # línea final incompleta: aún no está escrita del todo
            try:
                obj = json.loads(raw)
            except ValueError:
                continue
            if not isinstance(obj, dict) or obj.get("type") != "assistant":
                continue
            msg = obj.get("message")
            if not isinstance(msg, dict) or not isinstance(msg.get("id"), str):
                continue
            if msg.get("model") == "<synthetic>":
                continue
            usage = msg.get("usage") if isinstance(msg.get("usage"), dict) else {}
            key = f"{msg['id']}:{obj.get('requestId') or ''}"
            vals = {k: usage.get(src) if isinstance(usage.get(src), (int, float)) else 0 for k, src in FIELDS}
            prev = out.get(key)
            out[key] = vals if prev is None else {k: max(prev[k], vals[k]) for k in vals}
    return out


def merge(into, more):
    for key, vals in more.items():
        prev = into.get(key)
        into[key] = vals if prev is None else {k: max(prev[k], vals[k]) for k in vals}


def total(evs):
    return {k: sum(v[k] for v in evs.values()) for k, _ in FIELDS}


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    root = sys.argv[1]
    as_json = "--json" in sys.argv
    sessions = {}
    everything = {}
    for project in sorted(os.listdir(root)):
        pdir = os.path.join(root, project)
        if not os.path.isdir(pdir):
            continue
        per_session = {}
        links = {}
        for name in sorted(os.listdir(pdir)):
            if not name.endswith(".jsonl"):
                continue
            sid = name[: -len(".jsonl")]
            evs = events(os.path.join(pdir, name))
            subdir = os.path.join(pdir, sid, "subagents")
            if os.path.isdir(subdir):
                for sub in sorted(os.listdir(subdir)):
                    if sub.endswith(".jsonl"):
                        merge(evs, events(os.path.join(subdir, sub)))
            merge(everything, evs)
            per_session[sid] = evs
            target = continued_in(os.path.join(pdir, name))
            if target:
                links[sid] = target
        previous = {}
        for src, dst in links.items():
            if dst in per_session and dst not in previous and dst != src:
                previous[dst] = src
        for sid, evs in per_session.items():
            prev_keys = set(per_session[previous[sid]]) if sid in previous else set()
            own = {k: v for k, v in evs.items() if k not in prev_keys}
            sessions[f"{project}/{sid}"] = {**total(evs), "events": len(evs), "propio": total(own)}
    report = {"sessions": sessions, "global": {**total(everything), "events": len(everything)}}
    if as_json:
        print(json.dumps(report, indent=2))
        return
    for ref, t in sessions.items():
        print(ref, t)
    print("GLOBAL", report["global"])


if __name__ == "__main__":
    main()
