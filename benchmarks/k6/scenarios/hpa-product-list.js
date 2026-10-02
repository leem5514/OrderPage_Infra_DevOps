import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import { baseUrl, buildLoadOptions, thinkTimeSeconds } from '../lib/config.js';

const apiBaseUrl = baseUrl();
const thinkTime = thinkTimeSeconds();
const productListSuccess = new Rate('product_list_success');
const productListDuration = new Trend('product_list_duration', true);

export const options = buildLoadOptions();

function requestProductList(requestName) {
  const response = http.get(`${apiBaseUrl}/product/list?page=0&size=20`, {
    tags: { name: requestName },
    timeout: '10s',
  });

  const success = check(response, {
    'product list status is 200': (result) => result.status === 200,
  });

  productListSuccess.add(success);
  productListDuration.add(response.timings.duration);
  return response;
}

export function setup() {
  const response = requestProductList('product_list_preflight');
  if (response.status !== 200) {
    throw new Error(`preflight failed: GET /product/list returned ${response.status}`);
  }
}

export default function () {
  requestProductList('product_list_load');
  sleep(thinkTime);
}
