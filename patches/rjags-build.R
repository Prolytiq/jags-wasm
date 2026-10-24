# Build rjags (/tmp/rjags-mod.tar.gz, configure removed, static Makevars) as an
# emscripten SIDE_MODULE against the wasm libjags prefix, replicating rwasm's
# cross-compilation env (webr-vars.mk) with two overrides:
#   * default visibility (C_VISIBILITY/CXX_VISIBILITY empty) so the linker keeps
#     R_init_rjags and .Call registration works;
#   * the optimisation level: webr-vars.mk's "WASM_OPT += -Oz" becomes
#     "-$RJAGS_OPT" (env var, default Oz = unchanged).
# SIDE_MODULE=1 comes from webr-vars.mk. NEVER MAIN_MODULE: it broke .Call
# registration (MAIN_MODULE=2 GC'd R_init_rjags; MAIN_MODULE=1 is a dead end).
# Writes the install library path to /tmp/rjags-out/libdir.

opt <- Sys.getenv("RJAGS_OPT", "Oz")
stopifnot(opt %in% c("Oz", "Os", "O1", "O2", "O3"))

tmp_dir <- tempfile(); dir.create(tmp_dir)
lib_dir <- "/tmp/rjags-lib"; unlink(lib_dir, recursive = TRUE); dir.create(lib_dir)
untar("/tmp/rjags-mod.tar.gz", exdir = tmp_dir)
stopifnot(dir.exists(file.path(tmp_dir, "rjags")))

webr_root <- "/opt/webr"
webr_version <- "4.6.0"
vars <- readLines(system.file("webr-vars.mk", package = "rwasm"))
i <- grep("^WASM_OPT \\+= -Oz", vars)
stopifnot(length(i) == 1)
vars[i] <- paste0("WASM_OPT += -", opt)
combined <- tempfile(fileext = ".mk")
cat(vars, "",
    "# rjags-wasm overrides (user makevars is applied LAST)",
    "C_VISIBILITY =",
    "CXX_VISIBILITY =",
    file = combined, sep = "\n")
stopifnot(!any(grepl("MAIN_MODULE", readLines(combined))))
cat("== WASM_OPT / LDFLAGS lines ==\n")
cat(grep("WASM_OPT|SIDE_MODULE", readLines(combined), value = TRUE), sep = "\n")

webr_env <- c(
  paste0("BUILD_PLATFORM=", R.Version()$platform),
  paste0("R_PROFILE_USER=", system.file("webr-profile", package = "rwasm")),
  paste0("R_MAKEVARS_USER=", combined),
  paste0("WEBR_VERSION=", webr_version),
  paste0("WEBR_ROOT=", webr_root),
  sprintf("PATH='%s:%s/host/bin:%s'", system.file("bin", package = "rwasm"),
          file.path(webr_root, "host"), Sys.getenv("PATH")),
  sprintf("PKG_CONFIG_PATH=%s/wasm/lib/pkgconfig", webr_root),
  sprintf("EM_HOST_CARGO=%s", Sys.which("cargo")),
  sprintf("EM_PKG_CONFIG=%s", Sys.which("pkg-config")),
  sprintf("EM_PKG_CONFIG_PATH=%s/wasm/lib/pkgconfig", webr_root)
)

# CMD INSTALL's dependency check resolves against lib_dir: put coda there
install.packages("coda", lib = lib_dir, repos = "https://cran.r-project.org",
                 quiet = TRUE)

status <- withr::with_dir(tmp_dir, system2(
  Sys.which("R"),
  args = c("CMD", "INSTALL", paste0("--library=", lib_dir), "rjags",
           "--no-docs", "--no-html", "--no-test-load",
           "--no-staged-install", "--no-byte-compile"),
  env = webr_env))
if (status != 0) stop("R CMD INSTALL rjags failed: ", status)

so <- file.path(lib_dir, "rjags", "libs", "rjags.so")
if (!file.exists(so)) stop("rjags.so not produced")
cat("rjags.so bytes:", file.info(so)$size, "\n")
dir.create("/tmp/rjags-out", showWarnings = FALSE)
writeLines(lib_dir, "/tmp/rjags-out/libdir")
