// 版本常量：sdkVersion 由构建期 define 注入（见 tsup.config.ts / vitest.config.ts）。

declare const __SDK_VERSION__: string

/** SDK 版本号（构建期注入）。 */
export const sdkVersion: string = __SDK_VERSION__

/** 上报协议版本，常量 1。 */
export const schemaVersion = 2