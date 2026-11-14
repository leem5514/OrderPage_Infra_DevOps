import http from 'k6/http';
import {check} from 'k6';
import {Counter} from 'k6/metrics';

const base=String(__ENV.BASE_URL||'').replace(/\/+$/,'');
if(!/^https:\/\/[^/?#]+$/.test(base))throw Error('BASE_URL must be one HTTPS API origin');
const rate=Number(__ENV.K6_RATE||'2');
if(!Number.isInteger(rate)||rate<1||rate>20)throw Error('K6_RATE must be 1..20 requests/s');
const duration=__ENV.K6_DURATION||'15m';
if(!/^([1-9]|[12][0-9]|30)m$/.test(duration))throw Error('K6_DURATION must be 1..30m');
const failures5xx=new Counter('api_5xx');
const transportFailures=new Counter('api_transport_failures');

export const options={
  discardResponseBodies:true,
  tags:{scenario_id:__ENV.SCENARIO_ID||'unassigned',variant:__ENV.VARIANT||'unassigned'},
  scenarios:{availability:{executor:'constant-arrival-rate',rate,timeUnit:'1s',duration,preAllocatedVUs:10,maxVUs:30}}
};

export default function(){
  const response=http.get(`${base}/product/list?page=0&size=20`,{tags:{name:'product_list'},timeout:'5s',redirects:0});
  check(response,{'GET product list returns 200':r=>r.status===200});
  if(response.status>=500)failures5xx.add(1);
  if(response.status===0)transportFailures.add(1);
}
