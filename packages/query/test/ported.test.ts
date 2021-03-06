import * as A from "@effect-ts/core/Collections/Immutable/Array"
import * as C from "@effect-ts/core/Collections/Immutable/Chunk"
import * as MAP from "@effect-ts/core/Collections/Immutable/Map"
import * as T from "@effect-ts/core/Effect"
import * as Ex from "@effect-ts/core/Effect/Exit"
import * as F from "@effect-ts/core/Effect/Fiber"
import * as REF from "@effect-ts/core/Effect/Ref"
import * as E from "@effect-ts/core/Either"
import { identity, pipe } from "@effect-ts/core/Function"
import type { Has } from "@effect-ts/core/Has"
import { tag } from "@effect-ts/core/Has"
import * as O from "@effect-ts/core/Option"
import * as TE from "@effect-ts/jest/Test"
import { NoSuchElementException } from "@effect-ts/system/GlobalExceptions"

import * as CH from "../src/Cache"
import * as CR from "../src/CompletedRequestMap"
import * as DS from "../src/DataSource"
import * as Q from "../src/Query"
import { QueryFailure } from "../src/QueryFailure"
import * as R from "../src/Request"

interface TestConsole {
  lines: REF.Ref<A.Array<string>>
}

const TestConsole = tag<TestConsole>()

const emptyTestConsole = T.map_(REF.makeRef<A.Array<string>>([]), (lines) => ({
  lines
}))

function putStrLn(line: string): T.RIO<Has<TestConsole>, void> {
  return T.accessServiceM(TestConsole)((c) =>
    REF.update_(c.lines, (lines) => A.concat_(lines, [line]))
  )
}

const getLogSize = T.accessServiceM(TestConsole)((c) =>
  T.map_(REF.get(c.lines), (lines) => lines.length)
)

const userIds: A.Array<number> = A.range(1, 26)

const userNames: MAP.Map<number, string> = MAP.make(
  A.zip_(
    userIds,
    A.map_(A.range(1, 26), (_) => _.toString(36))
  )
)

class GetAllIds extends R.Static<{}, never, A.Array<number>> {
  readonly _tag = "GetAllIds"
}

class GetNameById extends R.Static<{ readonly id: number }, never, string> {
  readonly _tag = "GetNameById"
}

class GetAgeByName extends R.Static<{ readonly name: string }, never, number> {
  readonly _tag = "GetAgeByName"
}

type UserRequest = GetAllIds | GetNameById | GetAgeByName

const UserRequestDataSource = DS.makeBatched("UserRequestDataSource")(
  (requests: C.Chunk<UserRequest>) =>
    putStrLn("Running request...")["|>"](
      T.zipRight(
        T.succeed(
          requests["|>"](
            C.reduce(CR.empty, (crm, _) => {
              switch (_._tag) {
                case "GetAllIds":
                  return CR.insert_(crm, _, E.right(userIds))
                case "GetNameById":
                  return O.fold_(
                    MAP.lookup_(userNames, _.id),
                    () => crm,
                    (userName) => CR.insert_(crm, _, E.right(userName))
                  )
                case "GetAgeByName":
                  return CR.insert_(crm, _, E.right(18 + _.name.length))
              }
            })
          )
        )
      )
    )
)["|>"](DS.batchN(100))

const getAllUserIds = Q.fromRequest(new GetAllIds(), UserRequestDataSource)

const getUserNameById = (id: number) =>
  Q.fromRequest(new GetNameById({ id }), UserRequestDataSource)

const getAllUserNames = getAllUserIds["|>"](Q.chain(Q.forEachPar(getUserNameById)))

const getAgeByName = (name: string) =>
  Q.fromRequest(new GetAgeByName({ name }), UserRequestDataSource)

const getAgeById = (id: number) =>
  getUserNameById(id)["|>"](Q.chain((name) => getAgeByName(name)))

describe("Query", () => {
  const r = TE.runtime()
  it("basic query", async () => {
    const f = pipe(
      Q.run(getAllUserIds),
      T.provideServiceM(TestConsole)(emptyTestConsole)
    )
    expect(await T.runPromise(f)).toEqual(userIds)
  })
  it("sequential", async () => {
    const f = pipe(
      Q.run(getAgeById(1)),
      T.provideServiceM(TestConsole)(emptyTestConsole)
    )
    expect(await T.runPromise(f)).toEqual(19)
  })
  it("sequential zip", async () => {
    const f = pipe(
      getUserNameById(1),
      Q.zipWith(getUserNameById(2), (a, b) => a + b),
      Q.run,
      T.provideServiceM(TestConsole)(emptyTestConsole)
    )
    expect(await T.runPromise(f)).toEqual("12")
  })
  it("parallel", async () => {
    const f = pipe(
      getUserNameById(1),
      Q.zipWithPar(getUserNameById(2), (a, b) => a + b),
      Q.run,
      T.provideServiceM(TestConsole)(emptyTestConsole)
    )
    expect(await T.runPromise(f)).toEqual("12")
  })
  it("solves_N_1_problem", async () => {
    const f = pipe(
      Q.run(getAllUserNames),
      T.chain(() => getLogSize),
      T.provideServiceM(TestConsole)(emptyTestConsole)
    )
    expect(await T.runPromise(f)).toEqual(2)
  })
  it("mapError does not prevent batching", async () => {
    const a = getUserNameById(1)
      ["|>"](Q.zip(getUserNameById(2)))
      ["|>"](Q.mapError(identity))

    const b = getUserNameById(3)
      ["|>"](Q.zip(getUserNameById(4)))
      ["|>"](Q.mapError(identity))

    const f = pipe(
      Q.collectAllPar([a, b]),
      Q.run,
      T.chain(() => getLogSize),
      T.provideServiceM(TestConsole)(emptyTestConsole)
    )
    expect(await T.runPromise(f)).toEqual(2)
  })
  it("failure to complete request is query failure", async () => {
    const f = pipe(
      getUserNameById(27),
      Q.run,
      T.provideServiceM(TestConsole)(emptyTestConsole)
    )
    expect(await T.runPromiseExit(T.untraced(f))).toEqual(
      Ex.die(new QueryFailure(UserRequestDataSource, new GetNameById({ id: 27 })))
    )
  })
  it("timed does not prevent batching", async () => {
    const a = getUserNameById(1)
      ["|>"](Q.zip(getUserNameById(2)))
      ["|>"](Q.timed)

    const b = getUserNameById(3)
      ["|>"](Q.zip(getUserNameById(4)))
      ["|>"](Q.timed)

    const f = pipe(
      Q.collectAllPar([a, b]),
      Q.run,
      T.chain(() => getLogSize),
      T.provideServiceM(TestConsole)(emptyTestConsole)
    )
    expect(await T.runPromise(f)).toEqual(2)
  })
  it("optional converts a query to one that returns its value optionally", async () => {
    const f = pipe(
      getUserNameById(27),
      Q.map(identity),
      Q.optional,
      Q.run,
      T.provideServiceM(TestConsole)(emptyTestConsole)
    )
    expect(await T.runPromise(f)).toEqual(O.none)
  })
  it("allows gen syntax", async () => {
    const f = pipe(
      Q.gen(function* ($) {
        const name1 = yield* $(getUserNameById(1))
        const name2 = yield* $(getUserNameById(2))
        const name3 = yield* $(getUserNameById(3))

        return name1 + name2 + name3
      }),
      Q.run,
      T.provideServiceM(TestConsole)(emptyTestConsole)
    )
    expect(await T.runPromise(f)).toEqual("123")
  })
  it("allows gen syntax - NoSuchElementException", async () => {
    const f = pipe(
      Q.gen(function* ($) {
        const name1 = yield* $(O.none)

        return name1
      }),
      Q.run,
      T.provideServiceM(TestConsole)(emptyTestConsole)
    )
    expect(await T.runPromiseExit(f)).toEqual(Ex.fail(new NoSuchElementException()))
  })
  it("allows gen syntax - either", async () => {
    const f = pipe(
      Q.gen(function* ($) {
        const name1 = yield* $(E.left("error"))

        return name1
      }),
      Q.run,
      T.provideServiceM(TestConsole)(emptyTestConsole)
    )
    expect(await T.runPromiseExit(f)).toEqual(Ex.fail("error"))
  })
  it("allows gen syntax - effect", async () => {
    const f = pipe(
      Q.gen(function* ($) {
        const a = yield* $(T.succeed("a"))
        const b = yield* $(T.succeed("b"))

        return `${a}-${b}`
      }),
      Q.run,
      T.provideServiceM(TestConsole)(emptyTestConsole)
    )
    expect(await T.runPromiseExit(f)).toEqual(Ex.succeed("a-b"))
  })
  it("allows gen syntax - tag", async () => {
    const t = tag<number>()
    const f = pipe(
      Q.gen(function* ($) {
        return yield* $(t)
      }),
      Q.run,
      T.provideService(t)(42)
    )
    expect(await T.runPromiseExit(f)).toEqual(Ex.succeed(42))
  })
  it("requests can be removed from the cache", async () => {
    const f = pipe(
      CH.empty,
      T.chain((cache) =>
        pipe(
          getUserNameById(1),
          Q.chain(() => Q.fromEffect(cache.remove(new GetNameById({ id: 1 })))),
          Q.chain(() => getUserNameById(1)),
          Q.runCache(cache)
        )
      ),
      T.chain(() => getLogSize),
      T.provideServiceM(TestConsole)(emptyTestConsole)
    )
    const result = await T.runPromiseExit(f)
    expect(result).toEqual(Ex.succeed(2))
  })
  it("should hit cache without failing", async () => {
    const f = pipe(
      getUserNameById(1),
      Q.chain(() => getUserNameById(1)),
      Q.run,
      T.chain(() => getLogSize),
      T.provideServiceM(TestConsole)(emptyTestConsole)
    )

    const result = await T.runPromiseExit(f)
    expect(result).toEqual(Ex.succeed(1))
  })
  r.it("times out a query that does not complete", () =>
    pipe(
      Q.never,
      Q.timeout(1000),
      Q.run,
      T.fork,
      T.tap(() => TE.adjust(1000)),
      T.chain((fiber) => F.join(fiber)),
      T.zipRight(T.succeedWith(() => expect(true).toBe(true)))
    )
  )
  r.it("prevents subsequent requests to data sources from being executed", () =>
    pipe(
      pipe(
        Q.fromEffect(T.sleep(2000)),
        Q.chain(() => Q.never),
        Q.timeout(2000),
        Q.run,
        T.fork
      ),
      T.tap(() => TE.adjust(2000)),
      T.chain((fiber) => F.join(fiber)),
      T.zipRight(T.succeedWith(() => expect(true).toBe(true)))
    )
  )
  r.it("regional caching should work with parallelism", () => {
    const a = pipe(
      getUserNameById(1), // should be un-cached (first call) (1st hit)
      Q.chain(() => Q.fromEffect(T.sleep(1000))),
      Q.chain(() => getUserNameById(1)), // should be un-cached (3rd hit)
      Q.uncached
    )
    const b = pipe(
      getUserNameById(2), // should be un-cached (different arg) (2nd hit)
      Q.chain(() => Q.fromEffect(T.sleep(500))),
      Q.cached
    )
    return pipe(
      pipe(
        Q.zipWithPar_(a, b, (a, b) => a + "-" + b),
        Q.run,
        T.fork
      ),
      T.tap(() => TE.adjust(500)),
      T.tap(() => TE.adjust(1500)),
      T.chain((fiber) => F.join(fiber)),
      T.chain(() => getLogSize),
      T.provideServiceM(TestConsole)(emptyTestConsole),
      T.map((n) => expect(n).toBe(3))
    )
  })
})
