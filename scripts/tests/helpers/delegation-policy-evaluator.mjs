// 테스트에 쓰는 작은 평가기다. 아래 연산자만 지원하며 AWS IAM 평가 엔진이 아니다.
// SCP·세션·resource policy·서비스가 실제 제공하는 context는 이 도구로 검증하지 않는다.
const array = value => Array.isArray(value) ? value : [value];
const matches = (pattern, value, ignoreCase = false) => new RegExp('^' + pattern.split('*').map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', ignoreCase ? 'i' : '').test(value);

function conditionMatches(condition, context) {
  return Object.entries(condition || {}).every(([operator, values]) => Object.entries(values).every(([key, expected]) => {
    if (!['Null', 'StringEquals', 'StringNotEquals', 'StringEqualsIfExists', 'StringNotEqualsIfExists', 'Bool', 'BoolIfExists', 'ForAnyValue:StringEqualsIgnoreCase', 'NumericLessThanEquals'].includes(operator)) throw Error('Unsupported condition operator: ' + operator);
    const actualKey = Object.keys(context).find(k => k.toLowerCase() === key.toLowerCase());
    const actual = actualKey === undefined ? undefined : context[actualKey];
    const absent = actual === undefined || actual === null || (Array.isArray(actual) && actual.length === 0);
    if (operator.endsWith('IfExists') && absent) return true;
    const comparison = operator.replace(/IfExists$/, '');
    if (operator === 'Null') return absent === (String(expected) === 'true');
    if (operator === 'ForAnyValue:StringEqualsIgnoreCase') return !absent && array(actual).some(a => array(expected).some(e => String(e).toLowerCase() === String(a).toLowerCase()));
    if (operator === 'NumericLessThanEquals') return !absent && array(actual).some(a => ['number', 'string'].includes(typeof a) && String(a).trim() !== '' && Number.isFinite(Number(a)) && array(expected).some(e => String(e).trim() !== '' && Number.isFinite(Number(e)) && Number(a) <= Number(e)));
    if (comparison === 'StringEquals') return !absent && array(actual).some(a => array(expected).includes(a));
    if (comparison === 'StringNotEquals') return absent || array(actual).every(a => !array(expected).includes(a));
    if (comparison === 'Bool') return !absent && array(actual).some(a => ['true', 'false'].includes(String(a)) && array(expected).map(String).includes(String(a)));
    throw Error('Unsupported condition operator: ' + operator);
  }));
}

export function evaluate(documents, {action, resource, context = {}}) {
  let allowed = false;
  for (const document of documents) for (const statement of document.Statement) {
    if (!array(statement.Action).some(p => matches(p, action, true))) continue;
    const resourceMatches = statement.NotResource ? !array(statement.NotResource).some(p => matches(p, resource)) : array(statement.Resource).some(p => matches(p, resource));
    if (!resourceMatches || !conditionMatches(statement.Condition, context)) continue;
    if (statement.Effect === 'Deny') return 'explicitDeny';
    if (statement.Effect === 'Allow') allowed = true;
  }
  return allowed ? 'allowed' : 'implicitDeny';
}
