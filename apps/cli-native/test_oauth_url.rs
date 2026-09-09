use url::Url;

const CLI_CLIENT_ID: &str = "quyan-cli";
const OAUTH_CALLBACK_HOST: &str = "127.0.0.1";
const OAUTH_CALLBACK_PORT: u16 = 40016;
const OAUTH_SCOPES: &str = "profile relay:token:read relay:token:create relay:token:update relay:token:delete relay:channel:read relay:usage:read balance:read";
const CODE_CHALLENGE_METHOD: &str = "S256";

fn build_browser_authorization_url(
    auth_base: &str,
    redirect_uri: &str,
    state: &str,
    code_challenge: &str,
) -> Result<Url, url::ParseError> {
    let mut url = Url::parse(&format!("{}/", auth_base.trim_end_matches('/')))?;
    url.query_pairs_mut()
        .append_pair("response_type", "code")
        .append_pair("client_id", CLI_CLIENT_ID)
        .append_pair("redirect_uri", redirect_uri)
        .append_pair("scope", OAUTH_SCOPES)
        .append_pair("state", state)
        .append_pair("code_challenge", code_challenge)
        .append_pair("code_challenge_method", CODE_CHALLENGE_METHOD);
    Ok(url)
}

fn main() {
    let redirect_uri = format!("http://{OAUTH_CALLBACK_HOST}:{OAUTH_CALLBACK_PORT}/callback");
    let url = build_browser_authorization_url(
        "https://auth.qysyw.cn",
        &redirect_uri,
        "test-state-123",
        "test-challenge-456"
    ).unwrap();
    println!("{}", url);
}
