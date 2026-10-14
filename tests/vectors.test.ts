import { describe, expect, it } from 'vitest';
import vectors from './vectors/pdf-quote-join.json';
import * as join from '../src/join';

describe('acceptance vectors', () => {
	it('has at least 20 independent cases', () => expect(vectors.cases.length).toBeGreaterThanOrEqual(20));
	for (const c of vectors.cases) it(c.name, () => {
		const fn = join[(c.function ?? 'joinWithPaths') as keyof typeof join] as (...args: unknown[]) => unknown;
		expect(fn(...c.args)).toEqual(c.expected);
	});
});
