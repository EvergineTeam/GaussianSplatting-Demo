(function (global) {
    const versions = global.GSPLAT_CACHE || {};

    function appendParam(url, name, value) {
        if (!value) {
            return url;
        }

        const separator = url.includes("?") ? "&" : "?";
        return `${url}${separator}${encodeURIComponent(name)}=${encodeURIComponent(value)}`;
    }

    function versionedUrl(key, url) {
        return appendParam(url, "v", versions[key]);
    }

    function workerUrl(url) {
        let result = versionedUrl("sortworker", url);
        result = appendParam(result, "nativeBundleJs", versions.nativeBundleJs);
        result = appendParam(result, "nativeBundleWasm", versions.nativeBundleWasm);
        return result;
    }

    function loadScript(key, url, attributes = {}) {
        const attrs = Object.entries(attributes)
            .map(([name, value]) => value === false ? "" : ` ${name}${value === true ? "" : `="${value}"`}`)
            .join("");
        document.write(`<script type="text/javascript" src="${versionedUrl(key, url)}"${attrs}><\/script>`);
    }

    function loadStylesheet(key, url) {
        document.write(`<link rel="stylesheet" href="${versionedUrl(key, url)}" />`);
    }

    global.gSplatCache = {
        versionedUrl,
        workerUrl,
        loadScript,
        loadStylesheet
    };
})(globalThis);
