let myWorker = new Worker(globalThis.gSplatCache?.workerUrl("evergine_sortworker.js") ?? "evergine_sortworker.js");
let returnResolves = {};
let cmdIdCounter = 0;
let initPromise = undefined;
let sortResultBuffer = undefined;
let sortResultByteLength = 0;
let useSharedSortResult = false;
let lastSortResultApplyTime = Number.NEGATIVE_INFINITY;

const sortResultStatus = Object.freeze({
    skipped: 0,
    copiedToWasm: 1,
    uploadedToTexture: 2
});

const trackedWebGLTextures = installWebGLTextureTracking();

myWorker.onmessage = function (e) {
    let cmdId = e.data[0];
    let returnResolve = returnResolves[cmdId];
    if (returnResolve) {
        returnResolve(...e.data.slice(1));
        delete returnResolves[cmdId];
    }
};

async function runWorkerCommand(cmd, parameters = [], transferList = []) {
    let cmdId = cmdIdCounter++;
    let workerSortPromise = new Promise((resolve, reject) => {
        returnResolves[cmdId] = resolve;
    });
    myWorker.postMessage([cmdId, cmd, ...parameters], transferList);
    return await workerSortPromise;
}

function getDotnetHeapU8() {
    const heap = getDotnetModule()?.HEAPU8;
    if (!heap) {
        throw new Error("Unable to locate the .NET WASM heap.");
    }

    return heap;
}

function getDotnetModule() {
    const runtime = globalThis.Blazor?.runtime ?? globalThis.getDotnetRuntime?.(0);
    return runtime?.Module;
}

function installWebGLTextureTracking() {
    if (!globalThis.__evergineGSplatWebGLTexturesByName) {
        globalThis.__evergineGSplatWebGLTexturesByName = new Map();
    }

    const textures = globalThis.__evergineGSplatWebGLTexturesByName;

    const rememberTexture = (texture) => {
        const name = texture?.name;
        if (Number.isInteger(name) && name > 0) {
            textures.set(name, texture);
        }
    };

    const forgetTexture = (texture) => {
        const name = texture?.name;
        if (Number.isInteger(name) && name > 0 && textures.get(name) === texture) {
            textures.delete(name);
        }
    };

    const patchContext = (contextType) => {
        const prototype = contextType?.prototype;
        if (!prototype || prototype.__evergineGSplatTextureTrackingPatched) {
            return;
        }

        const bindTexture = prototype.bindTexture;
        const deleteTexture = prototype.deleteTexture;

        Object.defineProperty(prototype, "__evergineGSplatTextureTrackingPatched", { value: true });
        prototype.bindTexture = function (target, texture) {
            rememberTexture(texture);
            return bindTexture.apply(this, arguments);
        };

        prototype.deleteTexture = function (texture) {
            forgetTexture(texture);
            return deleteTexture.apply(this, arguments);
        };
    };

    patchContext(globalThis.WebGLRenderingContext);
    patchContext(globalThis.WebGL2RenderingContext);

    return textures;
}

function uploadSortResultToWebGLTexture(sortedBytes, byteLength, textureId, textureWidth, textureHeight) {
    const gl = getDotnetModule()?.ctx;
    const textureName = Number(textureId);
    const width = Number(textureWidth);
    const height = Number(textureHeight);

    if (!gl ||
        typeof gl.texSubImage2D !== "function" ||
        gl.RED_INTEGER === undefined ||
        !Number.isInteger(textureName) ||
        textureName <= 0 ||
        !Number.isInteger(width) ||
        !Number.isInteger(height) ||
        width <= 0 ||
        height <= 0 ||
        byteLength !== width * height * Uint32Array.BYTES_PER_ELEMENT ||
        (sortedBytes.byteOffset % Uint32Array.BYTES_PER_ELEMENT) !== 0) {
        return false;
    }

    const texture = trackedWebGLTextures.get(textureName);
    if (!texture) {
        return false;
    }

    let previousTexture;
    let previousUnpackAlignment;
    try {
        const uploadData = new Uint32Array(sortedBytes.buffer, sortedBytes.byteOffset, byteLength / Uint32Array.BYTES_PER_ELEMENT);
        previousTexture = gl.getParameter(gl.TEXTURE_BINDING_2D);
        previousUnpackAlignment = gl.getParameter(gl.UNPACK_ALIGNMENT);

        gl.bindTexture(gl.TEXTURE_2D, texture);
        if (previousUnpackAlignment !== 4) {
            gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
        }

        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RED_INTEGER, gl.UNSIGNED_INT, uploadData);
        return gl.getError() === gl.NO_ERROR;
    } catch {
        return false;
    } finally {
        if (previousUnpackAlignment !== undefined && previousUnpackAlignment !== 4) {
            gl.pixelStorei(gl.UNPACK_ALIGNMENT, previousUnpackAlignment);
        }

        if (previousTexture !== undefined) {
            gl.bindTexture(gl.TEXTURE_2D, previousTexture);
        }
    }
}

function copyCentersFromDotnetMemory(centersPtr, stride, centersSize) {
    const vector3Bytes = 12;
    const centersByteLength = Number(centersSize) * vector3Bytes;
    const sourcePtr = Number(centersPtr);
    const sourceStride = Number(stride);
    const heap = getDotnetHeapU8();

    if (sourceStride === vector3Bytes) {
        return heap.slice(sourcePtr, sourcePtr + centersByteLength).buffer;
    }

    const centersBytes = new Uint8Array(centersByteLength);
    for (let i = 0; i < Number(centersSize); i++) {
        const sourceOffset = sourcePtr + (i * sourceStride);
        const targetOffset = i * vector3Bytes;
        centersBytes.set(heap.subarray(sourceOffset, sourceOffset + vector3Bytes), targetOffset);
    }

    return centersBytes.buffer;
}

async function workerInitFromWasmMemory(centersPtr, stride, centersSize, arraySize) {
    const splatCenters = copyCentersFromDotnetMemory(centersPtr, stride, centersSize);
    sortResultByteLength = Number(arraySize) * Uint32Array.BYTES_PER_ELEMENT;
    sortResultBuffer = undefined;
    useSharedSortResult = false;
    lastSortResultApplyTime = Number.NEGATIVE_INFINITY;

    initPromise = runWorkerCommand('init', [splatCenters, centersSize, arraySize], [splatCenters]);
}

async function workerSortToWasm(
    cameraPosition,
    cameraDirection,
    resultPtr,
    resultByteLength,
    cameraVersionPtr,
    sortCameraVersion,
    staleSortUploadIntervalMilliseconds,
    orderTextureNativePointer,
    orderTextureWidth,
    orderTextureHeight) {
    await initPromise;

    if (!sortResultBuffer) {
        useSharedSortResult = typeof SharedArrayBuffer === 'function';
        sortResultBuffer = useSharedSortResult
            ? new SharedArrayBuffer(sortResultByteLength)
            : new ArrayBuffer(sortResultByteLength);
    }

    let sortedBytes;
    if (useSharedSortResult) {
        await runWorkerCommand('sort', [cameraPosition, cameraDirection, sortResultBuffer]);
        sortedBytes = new Uint8Array(sortResultBuffer);
    } else {
        sortedBytes = await runWorkerCommand(
            'sort',
            [cameraPosition, cameraDirection, sortResultBuffer],
            [sortResultBuffer]);
        sortResultBuffer = sortedBytes.buffer;
    }

    const heap = getDotnetHeapU8();
    if (cameraVersionPtr !== undefined && sortCameraVersion !== undefined) {
        const versionPtr = Number(cameraVersionPtr);
        const latestCameraVersion = new Uint32Array(heap.buffer, versionPtr, 1)[0];
        if (latestCameraVersion !== Number(sortCameraVersion)) {
            const now = globalThis.performance?.now?.() ?? Date.now();
            const minInterval = Number(staleSortUploadIntervalMilliseconds ?? 0);
            if (minInterval > 0 && now - lastSortResultApplyTime < minInterval) {
                return sortResultStatus.skipped;
            }
        }
    }

    const byteLength = Number(resultByteLength);
    if (byteLength > sortResultByteLength) {
        throw new Error(`Sort result target is too small: ${byteLength} > ${sortResultByteLength}.`);
    }

    if (uploadSortResultToWebGLTexture(sortedBytes, byteLength, orderTextureNativePointer, orderTextureWidth, orderTextureHeight)) {
        lastSortResultApplyTime = globalThis.performance?.now?.() ?? Date.now();
        return sortResultStatus.uploadedToTexture;
    }

    heap.set(sortedBytes.subarray(0, byteLength), Number(resultPtr));
    lastSortResultApplyTime = globalThis.performance?.now?.() ?? Date.now();
    return sortResultStatus.copiedToWasm;
}

async function workerDispose() {
    if (initPromise) {
        await initPromise;
    }

    await runWorkerCommand('dispose');
    initPromise = undefined;
    sortResultBuffer = undefined;
    sortResultByteLength = 0;
    useSharedSortResult = false;
    lastSortResultApplyTime = Number.NEGATIVE_INFINITY;
}
