//! Minimal blocking HTTPS over wasi:http. (wasi-http-client writes a request body in one call, and
//! WASI caps one write at 4096 bytes — our NEAR AI request is ~10–50 KB.)

use std::time::Duration;

use wasi::http::outgoing_handler;
use wasi::http::types::{Fields, Method, OutgoingBody, OutgoingRequest, RequestOptions, Scheme};
use wasi::io::streams::StreamError;

pub struct Response {
    pub status: u16,
    pub location: Option<String>,
    pub body: Vec<u8>,
}

pub fn get(url: &str, headers: &[(&str, String)]) -> Result<Response, String> {
    send(Method::Get, url, headers, None)
}

pub fn post(url: &str, headers: &[(&str, String)], body: &[u8]) -> Result<Response, String> {
    send(Method::Post, url, headers, Some(body))
}

fn send(method: Method, url: &str, headers: &[(&str, String)], body: Option<&[u8]>) -> Result<Response, String> {
    let started = std::time::Instant::now();
    let r = send_once(method, url, headers, body);
    if std::env::var("PATCHBOND_TRACE").is_ok() {
        eprintln!("{:>6} ms {} {}", started.elapsed().as_millis(), r.as_ref().map_or(0, |r| r.status), url.split('?').next().unwrap_or(url));
    }
    r
}

fn send_once(method: Method, url: &str, headers: &[(&str, String)], body: Option<&[u8]>) -> Result<Response, String> {
    let rest = url.strip_prefix("https://").ok_or_else(|| format!("only https URLs: {url}"))?;
    let (authority, path) = match rest.find('/') {
        Some(i) => (&rest[..i], &rest[i..]),
        None => (rest, "/"),
    };
    let fields = Fields::new();
    for (k, v) in headers {
        fields.append(&k.to_string(), &v.as_bytes().to_vec()).map_err(|e| format!("header {k}: {e:?}"))?;
    }
    let req = OutgoingRequest::new(fields);
    req.set_method(&method).map_err(|_| "method")?;
    req.set_scheme(Some(&Scheme::Https)).map_err(|_| "scheme")?;
    req.set_authority(Some(authority)).map_err(|_| "authority")?;
    req.set_path_with_query(Some(path)).map_err(|_| "path")?;

    let out = req.body().map_err(|_| "request body")?;
    let options = RequestOptions::new();
    let _ = options.set_connect_timeout(Some(Duration::from_secs(20).as_nanos() as u64));
    let _ = options.set_first_byte_timeout(Some(Duration::from_secs(90).as_nanos() as u64));
    // Hand the request to the host first, then stream the body: writing a large body before
    // `handle` fills the host's buffer and blocks forever.
    let pending = outgoing_handler::handle(req, Some(options)).map_err(|e| format!("{url}: {e:?}"))?;
    if let Some(body) = body {
        let stream = out.write().map_err(|_| "request stream")?;
        for chunk in body.chunks(4096) {
            stream.blocking_write_and_flush(chunk).map_err(|e| format!("write: {e:?}"))?;
        }
        drop(stream);
    }
    OutgoingBody::finish(out, None).map_err(|e| format!("finish: {e:?}"))?;

    let res = match pending.get() {
        Some(r) => r,
        None => {
            pending.subscribe().block();
            pending.get().ok_or("no response")?
        }
    }
    .map_err(|_| "response taken")?
    .map_err(|e| format!("{authority}: {e:?}"))?;

    let status = res.status();
    let location = res.headers().get(&"location".to_string()).first().map(|v| String::from_utf8_lossy(v).into_owned());
    let incoming = res.consume().map_err(|_| "response body")?;
    let mut data = Vec::new();
    {
        let stream = incoming.stream().map_err(|_| "response stream")?;
        loop {
            match stream.blocking_read(1 << 20) {
                Ok(mut c) => data.append(&mut c),
                Err(StreamError::Closed) => break,
                Err(e) => return Err(format!("read: {e:?}")),
            }
        }
    }
    drop(incoming);
    Ok(Response { status, location, body: data })
}
