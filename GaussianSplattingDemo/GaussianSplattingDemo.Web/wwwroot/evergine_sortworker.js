let startPromise = new Promise((resolve, reject) => {
    try {
        Module = {
            onRuntimeInitialized: resolve
        };
        importScripts("gsplat_native_bundle.js");
    } catch (e) {
        reject(e);
    }
});

async function main() {
    await startPromise;
    //console.log("Worker initilized");
}

let currentSortResult = undefined;

let splats = undefined;
let gsplatSorter = undefined;
let orderPtr = undefined;
let orderView = undefined;

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
            }

            // Parameters: splat centers array
            let splatCenters = params[0]; // ArrayBuffer of splat centers
            let centersLength = params[1]; // length of centers
            let sortResult = params[2]; // SharedArrayBuffer of sort result

            splats = new Uint8Array(splatCenters);
            orderView = new Uint8Array(sortResult);
            arraySize = splats.length / 3;
            
            var splatsPtr = Module._malloc(splats.length);
            Module.HEAPU8.set(splats, splatsPtr);

            gsplatSorter = Module._InitSorter(splatsPtr, 4 * 3, centersLength);

            Module._free(splatsPtr);

            console.log("GSplatSorter: ", gsplatSorter);

            currentSortResult = sortResult;
            
            orderPtr = Module._malloc(orderView.length * 4);

            postMessage([cmdId]);
        } else if (cmd == 'sort') {
            if (!currentSortResult) {
                throw new Error('You must call Init method before.');
            }
            // Parameters: camera position and direction
            // Return: sorted splat indices
            let camPos = params[0];
            let camDir = params[1];

            //console.time("Worker native sort");
            Module._Sort(gsplatSorter, camPos[0], camPos[1], camPos[2], camDir[0], camDir[1], camDir[2], orderPtr, orderView.length / 4);
            //console.timeEnd("Worker native sort");
            
            orderView.set(Module.HEAPU8.subarray(orderPtr, orderPtr + orderView.length));

            postMessage([cmdId, orderView]);
        } else if (cmd == 'dispose') {
            // Release all resources
            if (gsplatSorter) {
                Module._DestroySorter(gsplatSorter);
                gsplatSorter = undefined;

                Module._free(orderPtr);
            }

            postMessage([cmdId, "Resources disposed"]);
        }
    } catch (e) {
        console.error(`Worker command error ${cmd}: ${e}`, e, e.stack);
        throw e;
    }
}

main();