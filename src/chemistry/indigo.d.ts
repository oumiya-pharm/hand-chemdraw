declare module 'indigo-ketcher/binaryWasm' { const create: (options?: { wasmBinary?: Uint8Array; locateFile?: (path:string)=>string }) => Promise<import('./engine').Indigo>; export default create; }
