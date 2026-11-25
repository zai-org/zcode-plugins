import { formatName } from './lib.js';
const express = require('express');

function render(user) {
  return '<h1>' + formatName(user) + '</h1>';
}

const helper = () => console.log('hi');
