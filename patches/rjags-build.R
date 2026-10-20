# Phase 1 driver: build the modified rjags against the wasm libjags prefix,
# replicating rwasm's cross-compilation env but tolerating whatever tarball
# name R CMD INSTALL --build produces (rwasm's own copy assumes the host
# platform name and errors on the rename when the wasm R names it differently).
# Success = either a binary tarball or the built rjags.so lands in /tmp/rjags-out.

tmp_dir <- tempfile()
dir.create(tmp_dir)
lib_dir <- tempfile()
dir.create(lib_dir)
untar("/tmp/rjags-mod.tar.gz", exdir = tmp_dir)

pkg_dir <- file.path(tmp_dir, "rjags")
stopifnot(dir.exists(pkg_dir))

webr_root <- "/opt/webr"
webr_version <- "4.6.0"
webr_vars <- system.file("webr-vars.mk", package = "rwasm")
webr_profile <- system.file("webr-profile", package = "rwasm")
sys_bin <- system.file("bin", package = "rwasm")

webr_env <- c(
  paste0("BUILD_PLATFORM=", R.Version()$platform),
  paste0("R_PROFILE_USER=", webr_profile),
  paste0("R_MAKEVARS_USER=", webr_vars),
  paste0("WEBR_VERSION=", webr_version),
  paste0("WEBR_ROOT=", webr_root),
  sprintf("PATH='%s:%s/host/bin:%s'", sys_bin,
          file.path(webr_root, "host"), Sys.getenv("PATH")),
  sprintf("PKG_CONFIG_PATH=%s/wasm/lib/pkgconfig", webr_root),
  sprintf("EM_HOST_CARGO=%s", Sys.which("cargo")),
  sprintf("EM_PKG_CONFIG=%s", Sys.which("pkg-config")),
  sprintf("EM_PKG_CONFIG_PATH=%s/wasm/lib/pkgconfig", webr_root)
)

# dependency check inside CMD INSTALL resolves against lib_dir: put coda there
install.packages("coda", lib = lib_dir, repos = "https://cran.r-project.org",
                 quiet = TRUE)

status <- withr::with_dir(
  tmp_dir,
  system2(
    Sys.which("R"),
    args = c("CMD", "INSTALL", "--build",
             paste0("--library=", lib_dir), "rjags",
             "--no-docs", "--no-html", "--no-test-load",
             "--no-staged-install", "--no-byte-compile"),
    env = webr_env
  )
)

out <- "/tmp/rjags-out"
dir.create(out, showWarnings = FALSE)

# whatever binary tarball --build produced
tars <- list.files(tmp_dir, pattern = "rjags.*\\.tar\\.gz$", full.names = TRUE)
for (t in tars) file.copy(t, out)

# and the raw shared object, from the source tree or the built library
so_src <- c(file.path(pkg_dir, "src", "rjags.so"),
            file.path(lib_dir, "rjags", "libs", "rjags.so"))
for (s in so_src) if (file.exists(s)) file.copy(s, out)

cat("== artifacts ==\n")
print(list.files(out, full.names = TRUE))
if (!length(list.files(out))) {
  stop("no rjags artifact produced")
}
