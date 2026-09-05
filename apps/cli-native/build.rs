use std::{env, fs, path::PathBuf};

fn main() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let swagger = manifest_dir.join("../backend/src/build/swagger.json");
    println!("cargo:rerun-if-changed={}", swagger.display());

    let output = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR")).join("codegen.rs");
    let file = fs::File::open(&swagger).unwrap_or_else(|error| {
        panic!(
            "Unable to read {}: {error}. Run `pnpm run openapi:gen` first.",
            swagger.display()
        )
    });
    let mut raw: serde_json::Value = serde_json::from_reader(file)
        .unwrap_or_else(|error| panic!("Invalid Swagger JSON {}: {error}", swagger.display()));
    // Progenitor does not model the backend's gzip/raw relay responses. They
    // are not used by the management CLI, so omit only those media entries
    // from the generated view while keeping the source Swagger unchanged.
    normalize_media_types(&mut raw);
    normalize_free_form_schemas(&mut raw);
    retain_cli_paths(&mut raw);
    normalize_responses(&mut raw);
    let spec: openapiv3::OpenAPI = serde_json::from_value(raw)
        .unwrap_or_else(|error| panic!("Invalid normalized Swagger document: {error}"));
    let mut generator = progenitor::Generator::default();
    let tokens = generator
        .generate_tokens(&spec)
        .unwrap_or_else(|error| panic!("Unable to generate Rust OpenAPI client: {error}"));
    let ast = syn::parse2(tokens).expect("Progenitor generated invalid Rust tokens");
    fs::write(output, prettyplease::unparse(&ast)).expect("Unable to write generated client");
}

fn retain_cli_paths(value: &mut serde_json::Value) {
    let Some(paths) = value
        .get_mut("paths")
        .and_then(serde_json::Value::as_object_mut)
    else {
        return;
    };
    let prefixes = [
        "/v1/users/me/profile",
        "/v1/balance/account",
        "/v1/balance/usage",
        "/v1/relay/tokens",
        "/v1/relay/tokens/{id}",
        "/v1/relay/tokens/{id}/usage",
        "/v1/relay-channels/routing-catalog",
        "/v1/products/json-endpoints",
        "/v1/auth/replay-signing-session",
        "/v1/auth/qr-login/session",
        "/v1/auth/qr-login/status",
        "/v1/auth/qr-login/consume",
        "/v1/auth/verify-2fa",
    ];
    paths.retain(|path, _| prefixes.iter().any(|prefix| path == prefix));
}

fn normalize_media_types(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::Object(object) => {
            if let Some(content) = object.get_mut("content") {
                if let serde_json::Value::Object(map) = content {
                    map.remove("application/gzip");
                }
            }
            for child in object.values_mut() {
                normalize_media_types(child);
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                normalize_media_types(item);
            }
        }
        _ => {}
    }
}

fn normalize_free_form_schemas(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::Object(object) => {
            if let Some(serde_json::Value::Object(schemas)) = object.get_mut("schemas") {
                schemas.remove("JsonValue");
            }
            if object
                .get("$ref")
                .and_then(serde_json::Value::as_str)
                .is_some_and(|reference| reference.ends_with("/JsonValue"))
            {
                object.clear();
                return;
            }
            for child in object.values_mut() {
                normalize_free_form_schemas(child);
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                normalize_free_form_schemas(item);
            }
        }
        _ => {}
    }
}

fn normalize_responses(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::Object(object) => {
            if let Some(serde_json::Value::Object(responses)) = object.get_mut("responses") {
                let success = responses
                    .keys()
                    .find(|key| key.as_str() == "200")
                    .cloned()
                    .or_else(|| responses.keys().find(|key| key.starts_with('2')).cloned());
                if let Some(success) = success {
                    let keys = responses.keys().cloned().collect::<Vec<_>>();
                    for key in keys {
                        if key.starts_with('2') && key != success {
                            responses.remove(&key);
                        }
                        if !key.starts_with('2') && key != "default" {
                            if let Some(response) = responses
                                .get_mut(&key)
                                .and_then(serde_json::Value::as_object_mut)
                            {
                                response.remove("content");
                            }
                        }
                    }
                }
            }
            for child in object.values_mut() {
                normalize_responses(child);
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                normalize_responses(item);
            }
        }
        _ => {}
    }
}
