#!/usr/bin/env python3
"""Add Fortran hidden character-length arguments to JAGS's BLAS/LAPACK calls.

The netlib BLAS/LAPACK we link into the module side modules is compiled by
flang, which appends one hidden `size_t` length argument per CHARACTER dummy
(dpotrf_(uplo, n, a, lda, info, uplo_len)). JAGS declares these routines
without the hidden lengths. On native targets the extra argument is simply
absent from the stack; under WebAssembly the call signature is checked and
wasm-ld replaces every such call with a trap stub ("function signature
mismatch: dpotrf_"), so dmnorm, dwish, %*%, inverse(), the conjugate
multivariate normal sampler, msm and glm's Wishart/CHOLMOD code all abort the
whole R process the first time they run.

Fix, applied to the JAGS source tree before configure:
  * C++ declarations (F77_* prototypes): append `size_t = 1` per char*
    parameter -- default arguments, so no call site changes. Every flag
    passed is a single character, so length 1 is exact.
  * CHOLMOD (C, glm module): append `size_t` per char* parameter to the
    BLAS_*/LAPACK_* prototypes in cholmod_blas.h and `, 1` per char* to the
    calls inside its wrapper macros.

Usage: fortran-hidden-lengths.py <JAGS source dir>
Fails unless every expected file was patched.
"""
import pathlib
import re
import sys

root = pathlib.Path(sys.argv[1])
CHAR_PARAM = re.compile(r"\bchar\s*\*")

CXX_FILES = [
    "src/modules/bugs/matrix/lapack.h",
    "src/modules/msm/matrix/lapack.h",
    "src/modules/glm/samplers/SampleWishart.cc",
    "src/modules/glm/samplers/ScaledWishart.cc",
    "src/modules/glm/distributions/DScaledWishart.cc",
]
CXX_PROTO = re.compile(r"\b(void|double|int)(\s+)(F77_[A-Z0-9_]+)(\s*\()([^;{}]*?)(\)\s*;)", re.S)


def patch_cxx(path: pathlib.Path) -> int:
    text = path.read_text()
    count = 0

    def fix(m):
        nonlocal count
        n = len(CHAR_PARAM.findall(m.group(5)))
        if n == 0 or "size_t" in m.group(5):
            return m.group(0)
        count += 1
        return m.group(1) + m.group(2) + m.group(3) + m.group(4) + m.group(5) + ", size_t = 1" * n + m.group(6)

    text = CXX_PROTO.sub(fix, text)
    if count:
        text = "#include <cstddef>\n" + text
        path.write_text(text)
    return count


CHOLMOD = "src/modules/glm/SSparse/CHOLMOD/Include/cholmod_blas.h"
C_PROTO = re.compile(r"\b(void|double|int)(\s+)((?:BLAS|LAPACK)_[DZ][A-Z0-9]+)(\s*\()([^;{}]*?)(\)\s*;)", re.S)
C_CALL = re.compile(r"(?<![A-Za-z0-9_ ])(\s*)((?:BLAS|LAPACK)_[DZ][A-Z0-9]+)(\s*\()([^;{}]*?)(\)\s*;)", re.S)


def patch_cholmod(path: pathlib.Path) -> tuple[int, int]:
    text = path.read_text()
    nchar: dict[str, int] = {}
    protos = 0

    def fix_proto(m):
        nonlocal protos
        n = len(CHAR_PARAM.findall(m.group(5)))
        nchar[m.group(3)] = n
        if n == 0:
            return m.group(0)
        protos += 1
        return m.group(1) + m.group(2) + m.group(3) + m.group(4) + m.group(5) + ", size_t" * n + m.group(6)

    text = C_PROTO.sub(fix_proto, text)

    # calls: the macro bodies call the uppercase symbol after a `{` / `;` / newline,
    # never after a type keyword (prototypes were handled above)
    calls = 0
    out, pos = [], 0
    for m in re.finditer(r"((?:BLAS|LAPACK)_[DZ][A-Z0-9]+)\s*\(", text):
        name = m.group(1)
        before = text[max(0, m.start() - 12):m.start()]
        if re.search(r"(void|double|int)\s+$", before) or re.search(r"#define\s+$", before):
            continue
        n = nchar.get(name, 0)
        if n == 0:
            continue
        # find the matching close paren
        depth, i = 1, m.end()
        while depth:
            c = text[i]
            depth += c == "("
            depth -= c == ")"
            i += 1
        close = i - 1
        out.append(text[pos:close])
        out.append(", 1" * n)
        pos = close
        calls += 1
    out.append(text[pos:])
    text = "".join(out)
    text = "#include <stddef.h>\n" + text
    path.write_text(text)
    return protos, calls


total = 0
for rel in CXX_FILES:
    n = patch_cxx(root / rel)
    print(f"{rel}: {n} prototypes")
    if n == 0:
        sys.exit(f"ERROR: nothing patched in {rel}")
    total += n
p, c = patch_cholmod(root / CHOLMOD)
print(f"{CHOLMOD}: {p} prototypes, {c} calls")
if p == 0 or c == 0:
    sys.exit("ERROR: CHOLMOD BLAS wrappers not patched")
print(f"OK: {total} C++ prototypes patched")
