#!/usr/bin/env bash
# Build the whole JAGS wasm stack at one optimisation level, inside
# ghcr.io/r-wasm/webr:main:
#   netlib BLAS/LAPACK -> libjags.a + libjrmath.a -> 8 modules (SIDE_MODULE .so)
#   -> rjags.so (SIDE_MODULE, libjags whole-archived, default visibility)
#   -> installed-tree tarball rjags_4-16.tgz (R code with a real .onLoad)
#
# Usage: scripts/build-stack.sh OPT [OUTDIR]
#   OPT = Oz  -> the current deployed flags, untouched (BLAS/LAPACK -O2,
#                JAGS compile flags as the wasm R Makeconf gives them,
#                module/rjags compile+link -Oz)
#   OPT = O2|O3|Os -> every -O flag (Fortran, C, C++, module link, rjags
#                compile+link) replaced by -$OPT
# Output: OUTDIR/rjags_4-16.tgz, OUTDIR/modules/*.so, OUTDIR/sizes.tsv
#
# rjags.so is a SIDE_MODULE. Never MAIN_MODULE (it broke .Call registration).
set -euo pipefail
OPT="${1:?usage: build-stack.sh OPT [OUTDIR]}"
OUT="${2:-/tmp/stack-out/$OPT}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
P=/tmp/jags-wasm-install
FL=/opt/flang/host/bin/flang
mkdir -p "$OUT/modules"

source /etc/profile 2>/dev/null || true
for f in /etc/profile.d/*.sh; do source "$f" 2>/dev/null || true; done

strip_opt() { perl -pe 's/(?<!\S)-O\S*//g; s/\s+/ /g'; }
if [ "$OPT" = "Oz" ]; then
  F_OPT="-O2"; C_OPT=""; L_OPT="-Oz"; BASELINE=1
else
  F_OPT="-$OPT"; C_OPT="-$OPT"; L_OPT="-$OPT"; BASELINE=0
fi
echo "### OPT=$OPT  F_OPT=$F_OPT  C_OPT=${C_OPT:-<Makeconf>}  L_OPT=$L_OPT"

# ---------------------------------------------------------------- BLAS/LAPACK
cd /tmp
curl -fsSL --retry 3 -o /tmp/blas.tgz "https://netlib.org/blas/blas.tgz"
curl -fsSL --retry 3 -o /tmp/lapackgh.tgz "https://github.com/Reference-LAPACK/lapack/archive/refs/tags/v3.12.0.tar.gz"
tar xzf /tmp/blas.tgz -C /tmp && tar xzf /tmp/lapackgh.tgz -C /tmp
cd /tmp/BLAS-3.12.0
$FL $F_OPT --target=wasm32-unknown-emscripten -fPIC -c *.f
emar cr libblas.a *.o && emranlib libblas.a
cd /tmp/lapack-3.12.0
cp make.inc.example make.inc
sed -i "s|^FC  *= .*|FC = $FL|; s|^FFLAGS  *= .*|FFLAGS = $F_OPT --target=wasm32-unknown-emscripten -fPIC|; s|^FFLAGS_NOOPT  *= .*|FFLAGS_NOOPT = -O0 --target=wasm32-unknown-emscripten -fPIC|; s|^LOADER   *= .*|LOADER = $FL|; s|^ARCH     *= .*|ARCH = emar|; s|^RANLIB   *= .*|RANLIB = emranlib|" make.inc
make lapacklib -j"$(nproc)" 2>&1 | tail -3
mkdir -p /tmp/lapack-wasm/lib && cp liblapack.a /tmp/lapack-wasm/lib/liblapack.a
# netlib lapack ships its own lsame/xerbla which collide with BLAS's
emar d /tmp/lapack-wasm/lib/liblapack.a lsame.o xerbla.o xerbla_array.o 2>/dev/null || true

# ---------------------------------------------------------------- JAGS source
curl -fsSL --retry 3 -o /tmp/jags.tar.gz \
  "https://downloads.sourceforge.net/project/mcmc-jags/JAGS/4.x/Source/JAGS-4.3.1.tar.gz"
tar xzf /tmp/jags.tar.gz -C /tmp
cp /usr/share/misc/config.sub /usr/share/misc/config.guess /tmp/JAGS-4.3.1/
grep -q emscripten /tmp/JAGS-4.3.1/config.sub
patch -p1 -d /tmp < "$HERE/patches/disttab-cxx17.patch"
find /tmp/JAGS-4.3.1/src \( -name "*.cc" -o -name "*.h" -o -name "*.cpp" \) | while read -r f; do
  perl -0pi -e 's/using std::binary_function;\n//g' "$f"
  perl -0pi -e 's/: public binary_function<[^>]*>//g' "$f"
  perl -pi -e 's/bind2nd\((\w+\(\)), /std::bind($1, std::placeholders::_1, /g' "$f"
done

# ---------------------------------------------------------------- configure
cd /tmp/JAGS-4.3.1
MC=$(ls /opt/R/wasm/lib/R/etc/Makeconf 2>/dev/null || find /opt -name Makeconf -path "*wasm*etc*" 2>/dev/null | head -1)
test -n "$MC"
val() { grep -E "^$1 *=" "$MC" | head -1 | sed "s/^$1 *= *//" | sed 's/\$([^)]*)//g' ; }
setopt() { if [ "$BASELINE" = 1 ]; then cat; else strip_opt | sed "s/\$/ $C_OPT/"; fi; }
export CC="$(val CC)" CXX="$(val CXX)" AR="$(val AR)" RANLIB="$(val RANLIB)"
export F77="$FL" FC="$FL" FLIBS="$(val FLIBS)"
export CFLAGS="$(val CFLAGS | setopt) -fPIC"
export CXXFLAGS="$(val CXXFLAGS | setopt) -fPIC"
export FFLAGS="$(val FFLAGS) $F_OPT -fwasm-exceptions -fPIC"
export FCFLAGS="$(val FCFLAGS) $F_OPT -fwasm-exceptions -fPIC"
export LDFLAGS="$(val LDFLAGS)"
echo "### Makeconf CFLAGS='$(val CFLAGS)' CXXFLAGS='$(val CXXFLAGS)'"
echo "### effective CFLAGS='$CFLAGS' CXXFLAGS='$CXXFLAGS' FFLAGS='$FFLAGS'"
./configure --host=wasm32-unknown-emscripten --prefix=$P --disable-dependency-tracking \
  --with-blas="-L/tmp/BLAS-3.12.0 -lblas" --with-lapack="-L/tmp/lapack-wasm/lib -llapack" \
  > configure.log 2>&1 || { tail -50 configure.log; exit 1; }

# ---------------------------------------------------------------- build
J=$(nproc)
make -C libltdl -j"$J" 2>&1 | tail -2
make -C src/jrmath -j"$J" 2>&1 | tail -2
make -C src/lib -j"$J" 2>&1 | tail -2
make -C src/modules -j"$J" 2>&1 | tail -2

rm -rf $P && mkdir -p $P/lib/jags/modules $P/include
cp -r src/include/* $P/include/
cp src/lib/.libs/libjags.a src/jrmath/.libs/libjrmath.a $P/lib/
find libltdl -name "libltdl*.a" -exec cp {} $P/lib/ \;
for a in src/modules/*/.libs/lib*.a; do
  n=$(basename "$a" .a)
  em++ -s SIDE_MODULE=1 -s WASM_BIGINT -s ASSERTIONS=1 -fwasm-exceptions -s SUPPORT_LONGJMP=wasm $L_OPT \
    -Wl,--whole-archive "$a" /tmp/BLAS-3.12.0/libblas.a /tmp/lapack-wasm/lib/liblapack.a /opt/flang/wasm/lib/libFortranRuntime.a -Wl,--no-whole-archive \
    -o "$P/lib/jags/modules/${n}.so"
done
NMOD=$(ls $P/lib/jags/modules/*.so | wc -l)
echo "### modules built: $NMOD"; [ "$NMOD" -ge 8 ]

# ---------------------------------------------------------------- rjags.so (SIDE_MODULE)
Rscript -e 'if (!requireNamespace("rwasm", quietly = TRUE)) install.packages("rwasm", repos = c("https://r-wasm.r-universe.dev", "https://cran.r-project.org"))' 2>&1 | tail -2
curl -fsSL -o /tmp/rjags.tar.gz "https://cran.r-project.org/src/contrib/rjags_4-16.tar.gz" || \
  curl -fsSL -o /tmp/rjags.tar.gz "https://cran.r-project.org/src/contrib/Archive/rjags/rjags_4-16.tar.gz"
rm -rf /tmp/rjags && tar xzf /tmp/rjags.tar.gz -C /tmp
cd /tmp/rjags
rm -f configure configure.ac configure.in configure.win cleanup
sed "s|@JAGS_MODDIR@|$P/lib/jags/modules|" R/unix/zzz.R.in > R/unix/zzz.R
cat > src/Makevars <<MKV
PKG_CPPFLAGS = -I$P/include
PKG_LIBS = -Wl,--whole-archive $P/lib/libjags.a $P/lib/libjrmath.a -Wl,--no-whole-archive -L$P/lib -lltdlc /opt/flang/wasm/lib/libFortranRuntime.a
MKV
cd /tmp && tar czf rjags-mod.tar.gz rjags
RJAGS_OPT="$OPT" Rscript "$HERE/patches/rjags-build.R" 2>&1 | tail -40
LIBDIR=$(cat /tmp/rjags-out/libdir)
test -f "$LIBDIR/rjags/libs/rjags.so"
Rscript -e "e <- new.env(); lazyLoad('$LIBDIR/rjags/R/rjags', envir = e); stopifnot(is.function(e\$.onLoad))"
head -c 4 "$LIBDIR/rjags/libs/rjags.so" | od -c | head -1   # \0asm
tar czf "$OUT/rjags_4-16.tgz" -C "$LIBDIR" rjags
cp $P/lib/jags/modules/*.so "$OUT/modules/"

# ---------------------------------------------------------------- sizes
{
  printf "file\tbytes\n"
  printf "rjags.so\t%s\n" "$(stat -c %s "$LIBDIR/rjags/libs/rjags.so")"
  printf "rjags_4-16.tgz\t%s\n" "$(stat -c %s "$OUT/rjags_4-16.tgz")"
  for f in "$OUT"/modules/*.so; do printf "%s\t%s\n" "$(basename "$f")" "$(stat -c %s "$f")"; done
  printf "modules_total\t%s\n" "$(cat "$OUT"/modules/*.so | wc -c)"
} > "$OUT/sizes.tsv"
cat "$OUT/sizes.tsv"
