use std::{
    ffi::OsString,
    path::{Path, PathBuf},
};

pub const DEFAULT_MCP_PORT: u16 = 3356;

#[derive(Clone, Debug, Default)]
pub struct Options {
    pub mcp: bool,
    pub no_mcp: bool,
    pub port: Option<u16>,
    pub help: bool,
    pub files: Vec<PathBuf>,
}

impl Options {
    pub fn parse(args: impl IntoIterator<Item = OsString>) -> Result<Self, String> {
        Self::parse_in(args, &std::env::current_dir().map_err(|e| e.to_string())?)
    }
    pub fn parse_in(args: impl IntoIterator<Item = OsString>, cwd: &Path) -> Result<Self, String> {
        let mut options = Self::default();
        let mut args = args.into_iter();
        let mut positional = false;
        while let Some(arg) = args.next() {
            let text = arg.to_string_lossy();
            if !positional {
                match text.as_ref() {
                    "--" => {
                        positional = true;
                        continue;
                    }
                    "--mcp" => {
                        options.mcp = true;
                        continue;
                    }
                    "--no-mcp" => {
                        options.no_mcp = true;
                        continue;
                    }
                    "--help" | "-h" => {
                        options.help = true;
                        continue;
                    }
                    "--mcp-port" => {
                        options.port = Some(port(
                            &args
                                .next()
                                .ok_or("--mcp-port requires a port")?
                                .to_string_lossy(),
                        )?);
                        continue;
                    }
                    _ => {}
                }
                if let Some(value) = text.strip_prefix("--mcp-port=") {
                    options.port = Some(port(value)?);
                    continue;
                }
                if text.starts_with('-') {
                    return Err(format!("Unknown option: {text}"));
                }
            }
            let path = PathBuf::from(arg);
            if crate::storage::supported(&path) {
                options.files.push(if path.is_absolute() {
                    path
                } else {
                    cwd.join(path)
                });
            }
        }
        if options.mcp && options.no_mcp {
            return Err("--mcp and --no-mcp cannot be used together".into());
        }
        if options.port.is_some() && !options.mcp {
            return Err("--mcp-port must be used with --mcp".into());
        }
        Ok(options)
    }
}

fn port(value: &str) -> Result<u16, String> {
    if value.is_empty() || !value.bytes().all(|b| b.is_ascii_digit()) {
        return Err("MCP port must be an integer from 0 to 65535 (0 selects a free port)".into());
    }
    value
        .parse()
        .map_err(|_| "MCP port must be an integer from 0 to 65535".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn parse(args: &[&str]) -> Result<Options, String> {
        Options::parse(args.iter().map(OsString::from))
    }
    #[test]
    fn flags_are_explicit_and_ports_are_validated() {
        assert!(!parse(&[]).unwrap().mcp);
        assert!(parse(&["--no-mcp"]).unwrap().no_mcp);
        assert_eq!(
            parse(&["--mcp", "--mcp-port", "4321"]).unwrap().port,
            Some(4321)
        );
        assert_eq!(parse(&["--mcp", "--mcp-port=0"]).unwrap().port, Some(0));
        for args in [
            vec!["--mcp-port", "1234"],
            vec!["--mcp", "--mcp-port"],
            vec!["--mcp", "--mcp-port=-1"],
            vec!["--mcp", "--mcp-port=65536"],
            vec!["--mcp-worker"],
            vec!["--mcp", "--no-mcp"],
            vec!["--no-mcp", "--mcp-port=1234"],
        ] {
            assert!(parse(&args).is_err(), "{args:?}");
        }
    }
    #[test]
    fn forwarded_files_use_the_callers_directory() {
        let cwd = std::env::temp_dir().join("pixprite-launch-test");
        let options = Options::parse_in([OsString::from("sprite.pixprite")], &cwd).unwrap();
        assert_eq!(options.files, vec![cwd.join("sprite.pixprite")]);
    }
}
