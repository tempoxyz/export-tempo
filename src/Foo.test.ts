import { Foo } from 'export-wallet'

describe('foo', () => {
  test('default', () => {
    expect(Foo.foo()).toBe('Hello, foo!')
  })
})
