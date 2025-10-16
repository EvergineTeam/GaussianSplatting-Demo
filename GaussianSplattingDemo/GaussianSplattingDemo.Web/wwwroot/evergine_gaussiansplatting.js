let myWorker = new Worker("evergine_sortworker.js");
let returnResolves = {};
let cmdIdCounter = 0;
let result = undefined;

myWorker.onmessage = function (e) {
    let cmdId = e.data[0];
    let returnResolve = returnResolves[cmdId];
    if (returnResolve) {
        returnResolve(...e.data.slice(1));
        delete returnResolves[cmdId];
    } else {
        console.debug(`Command return promise not found: ${cmdId}`);
    }
};

async function runWorkerCommand(cmd, ...paramters) {
    let cmdId = cmdIdCounter++;
    let workerSortPromise = new Promise((resolve, reject) => {
        returnResolves[cmdId] = resolve;
    });
    myWorker.postMessage([cmdId, cmd, ...paramters]);
    return await workerSortPromise;
}

async function workerInit(centersBytes, centersSize, arraySize) {
    let splatCenters = Blazor.platform.toUint8Array(centersBytes).buffer;
    let sortResult = new SharedArrayBuffer(arraySize * Uint32Array.BYTES_PER_ELEMENT);
    let initPromise = runWorkerCommand('init', splatCenters, centersSize, sortResult);
    window.workerSort = async function workerSort(cameraPosition, cameraDirection) {
        await initPromise;
        result = await runWorkerCommand('sort', cameraPosition, cameraDirection);
        window.workerSortResult = function workerSortResult() {
            var handle = BINDING.js_typed_array_to_array(result);
            return handle;
        }
    }

    window.workerDispose = async function workerDispose() {
        await initPromise;
        let result = await runWorkerCommand('dispose');
    }
}