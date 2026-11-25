// 打包时生成 dist/vendor/react.js：浏览器里的组件目录页通过 globalThis.__dc 使用 React。
import * as React from "react";
import * as JSX from "react/jsx-runtime";
import * as DOM from "react-dom";
import * as DOMClient from "react-dom/client";
(globalThis as unknown as { __dc: unknown }).__dc = { React, JSX, DOM, DOMClient };
