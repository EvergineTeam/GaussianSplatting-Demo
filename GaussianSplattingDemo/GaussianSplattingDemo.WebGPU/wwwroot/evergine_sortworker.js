let startPromise = new Promise((resolve, reject) => {
    try {
        const cacheParams = new URL(self.location.href).searchParams;
        const nativeBundleJsVersion = cacheParams.get("nativeBundleJs");
        const nativeBundleWasmVersion = cacheParams.get("nativeBundleWasm");
        const versionedUrl = (url, version) => {
            if (!version) {
                return url;
            }

            return `${url}${url.includes("?") ? "&" : "?"}v=${encodeURIComponent(version)}`;
        };

        Module = {
            onRuntimeInitialized: resolve,
            locateFile(path) {
                if (path.endsWith(".wasm")) {
                    return versionedUrl(path, nativeBundleWasmVersion);
                }

                return path;
            }
        };
        importScripts(versionedUrl("gsplat_native_bundle.js", nativeBundleJsVersion));
    } catch (e) {
        reject(e);
    }
});

async function main() {
    await startPromise;
}

let currentSortResult = undefined;

let gsplatSorter = undefined;
let orderPtr = undefined;
let orderView = undefined;
let orderByteLength = 0;

onmessage = async function (e) {
    let cmdId = e.data[0];
    let cmd = e.data[1];
    try {
        await startPromise;
        let params = e.data.slice(2);
        if (cmd == 'init') {
            
            if (gsplatSorter != undefined) {
                Module._DestroySorter(gsplatSorter);
                gsplatSorter = undefined;
                Module._free(orderPtr);
                orderPtr = undefined;
            }

            // Parameters: splat centers array
            let splatCenters = params[0]; // ArrayBuffer of splat centers
            let centersLength = params[1]; // length of centers
            let arraySize = params[2]; // output order length
            let sortResult = params[3]; // optional SharedArrayBuffer of sort result

            let splats = new Uint8Array(splatCenters);
            var splatsPtr = Module._malloc(splats.length);
            Module.HEAPU8.set(splats, splatsPtr);

            gsplatSorter = Module._InitSorter(splatsPtr, 4 * 3, centersLength);

            Module._free(splatsPtr);
            splats = undefined;
            splatCenters = undefined;

            currentSortResult = sortResult;
            orderByteLength = arraySize * Uint32Array.BYTES_PER_ELEMENT;
            orderView = sortResult ? new Uint8Array(sortResult) : undefined;
            orderPtr = Module._malloc(orderByteLength);

            postMessage([cmdId]);
        } else if (cmd == 'sort') {
            if (!gsplatSorter || !orderPtr) {
                throw new Error('You must call Init method before.');
            }

            // Parameters: camera position and direction
            // Return: sorted splat indices
            let camPos = params[0];
            let camDir = params[1];
            let transferredSortResult = params[2];
            let canTransferSortResult = transferredSortResult && !(typeof SharedArrayBuffer === 'function' && transferredSortResult instanceof SharedArrayBuffer);
            if (transferredSortResult) {
                currentSortResult = transferredSortResult;
                orderView = new Uint8Array(transferredSortResult);
            } else if (!currentSortResult || !orderView) {
                throw new Error('Sort result buffer is missing.');
            }

            Module._Sort(gsplatSorter, camPos[0], camPos[1], camPos[2], camDir[0], camDir[1], camDir[2], orderPtr, orderByteLength / 4);
            
            orderView.set(Module.HEAPU8.subarray(orderPtr, orderPtr + orderByteLength));

            if (canTransferSortResult) {
                postMessage([cmdId, orderView], [orderView.buffer]);
                orderView = undefined;
                currentSortResult = undefined;
            } else {
                postMessage([cmdId]);
            }
        } else if (cmd == 'dispose') {
            // Release all resources
            if (gsplatSorter) {
                Module._DestroySorter(gsplatSorter);
                gsplatSorter = undefined;

                Module._free(orderPtr);
                orderPtr = undefined;
            }

            orderView = undefined;
            currentSortResult = undefined;
            orderByteLength = 0;
            postMessage([cmdId, "Resources disposed"]);
        }
    } catch (e) {
        console.error(`Worker command error ${cmd}: ${e}`, e, e.stack);
        throw e;
    }
}

main();
