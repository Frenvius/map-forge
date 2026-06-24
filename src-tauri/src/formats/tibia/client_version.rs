use super::otbm::read_otbm_version;
use serde::Serialize;

struct VersionEntry {
    otb_id: u32,
    dir: &'static str,
}

const VERSIONS: &[VersionEntry] = &[
    VersionEntry { otb_id: 1, dir: "740" },
    VersionEntry { otb_id: 2, dir: "755" },
    VersionEntry { otb_id: 3, dir: "760" },
    VersionEntry { otb_id: 4, dir: "780" },
    VersionEntry { otb_id: 5, dir: "790" },
    VersionEntry { otb_id: 6, dir: "792" },
    VersionEntry { otb_id: 7, dir: "800" },
    VersionEntry { otb_id: 8, dir: "810" },
    VersionEntry { otb_id: 9, dir: "811" },
    VersionEntry { otb_id: 10, dir: "820" },
    VersionEntry { otb_id: 11, dir: "830" },
    VersionEntry { otb_id: 12, dir: "840" },
    VersionEntry { otb_id: 13, dir: "841" },
    VersionEntry { otb_id: 14, dir: "842" },
    VersionEntry { otb_id: 15, dir: "850" },
    VersionEntry { otb_id: 17, dir: "854" },
    VersionEntry { otb_id: 18, dir: "855" },
    VersionEntry { otb_id: 20, dir: "860" },
    VersionEntry { otb_id: 21, dir: "861" },
    VersionEntry { otb_id: 22, dir: "862" },
    VersionEntry { otb_id: 23, dir: "870" },
    VersionEntry { otb_id: 24, dir: "871" },
    VersionEntry { otb_id: 25, dir: "872" },
    VersionEntry { otb_id: 26, dir: "873" },
    VersionEntry { otb_id: 27, dir: "900" },
    VersionEntry { otb_id: 28, dir: "910" },
    VersionEntry { otb_id: 29, dir: "920" },
    VersionEntry { otb_id: 30, dir: "940" },
    VersionEntry { otb_id: 34, dir: "944" },
    VersionEntry { otb_id: 35, dir: "946" },
    VersionEntry { otb_id: 36, dir: "950" },
    VersionEntry { otb_id: 37, dir: "952" },
    VersionEntry { otb_id: 38, dir: "953" },
    VersionEntry { otb_id: 39, dir: "954" },
    VersionEntry { otb_id: 40, dir: "960" },
    VersionEntry { otb_id: 41, dir: "961" },
    VersionEntry { otb_id: 42, dir: "963" },
    VersionEntry { otb_id: 43, dir: "970" },
    VersionEntry { otb_id: 44, dir: "980" },
    VersionEntry { otb_id: 45, dir: "981" },
    VersionEntry { otb_id: 46, dir: "982" },
    VersionEntry { otb_id: 47, dir: "983" },
    VersionEntry { otb_id: 48, dir: "985" },
    VersionEntry { otb_id: 49, dir: "986" },
    VersionEntry { otb_id: 50, dir: "1010" },
    VersionEntry { otb_id: 51, dir: "1020" },
    VersionEntry { otb_id: 52, dir: "1021" },
    VersionEntry { otb_id: 53, dir: "1030" },
    VersionEntry { otb_id: 54, dir: "1031" },
    VersionEntry { otb_id: 55, dir: "1041" },
    VersionEntry { otb_id: 56, dir: "1077" },
    VersionEntry { otb_id: 57, dir: "1098" },
    VersionEntry { otb_id: 58, dir: "10100" },
    VersionEntry { otb_id: 59, dir: "1271" },
    VersionEntry { otb_id: 60, dir: "1281" },
    VersionEntry { otb_id: 61, dir: "1285" },
    VersionEntry { otb_id: 62, dir: "1286" },
    VersionEntry { otb_id: 63, dir: "1287" },
    VersionEntry { otb_id: 64, dir: "1290" },
    VersionEntry { otb_id: 65, dir: "1310" },
    VersionEntry { otb_id: 66, dir: "1320" },
];

pub fn data_dir_for_otb_id(otb_id: u32) -> Option<&'static str> {
    VERSIONS.iter().rev().find(|v| v.otb_id == otb_id).map(|v| v.dir)
}

#[derive(Serialize)]
pub struct OtbmVersionInfo {
    pub otbm_version: u32,
    pub items_major: u32,
    pub items_minor: u32,
    pub data_dir: Option<String>,
    pub version: Option<u32>,
}

#[tauri::command]
pub fn peek_otbm_version(path: String) -> Result<OtbmVersionInfo, String> {
    let mut f = std::fs::File::open(&path).map_err(|e| format!("Failed to open {}: {}", path, e))?;
    let mut buf = vec![0u8; 256];
    use std::io::Read;
    let n = f.read(&mut buf).map_err(|e| format!("read error: {}", e))?;
    buf.truncate(n);

    let (otbm_version, items_major, items_minor) = read_otbm_version(&buf)?;
    let dir_name = data_dir_for_otb_id(items_minor);
    let version = dir_name.and_then(|d| d.parse::<u32>().ok());
    let data_dir = dir_name.and_then(|d| {
        let dir = crate::commands::data_dir_for(d.parse::<u32>().unwrap_or(0), None);
        let otb = std::path::Path::new(&dir).join("items.otb");
        otb.is_file().then_some(dir)
    });

    Ok(OtbmVersionInfo { otbm_version, items_major, items_minor, data_dir, version })
}
