import { authEvents$, def as platformAuth } from "@platform/auth"
import {
  createEnvironment,
  deleteEnvironment,
  environmentsStore,
  getLocalIndexByEnvironmentID,
  replaceEnvironments,
  setGlobalEnvID,
  setGlobalEnvVariables,
  updateEnvironment,
} from "@hoppscotch/common/newstore/environments"

import { EnvironmentsPlatformDef } from "@hoppscotch/common/src/platform/environments"
import { runGQLSubscription } from "@hoppscotch/common/helpers/backend/GQLClient"

import { environnmentsSyncer } from "@platform/environments/environments.sync"

import * as E from "fp-ts/Either"
import { runDispatchWithOutSyncing } from "@lib/sync"
import {
  createUserGlobalEnvironment,
  getGlobalEnvironments,
  getUserEnvironments,
  runUserEnvironmentCreatedSubscription,
  runUserEnvironmentDeletedSubscription,
  runUserEnvironmentUpdatedSubscription,
} from "@platform/environments/environments.api"
import { entityReference } from "verzod"
import {
  Environment,
  EnvironmentSchemaVersion,
  GlobalEnvironment,
} from "@hoppscotch/data"

export function initEnvironmentsSync() {
  const currentUser$ = platformAuth.getCurrentUserStream()

  environnmentsSyncer.startStoreSync()
  environnmentsSyncer.setupSubscriptions(setupSubscriptions)

  currentUser$.subscribe(async (user) => {
    if (user) {
      await loadAllEnvironments()
    }
  })

  authEvents$.subscribe((event) => {
    if (event.event == "login" || event.event == "token_refresh") {
      environnmentsSyncer.startListeningToSubscriptions()
    }

    if (event.event == "logout") {
      environnmentsSyncer.stopListeningToSubscriptions()
    }
  })
}

export const def: EnvironmentsPlatformDef = {
  initEnvironmentsSync,
}

function setupSubscriptions() {
  let subs: ReturnType<typeof runGQLSubscription>[1][] = []

  const userEnvironmentCreatedSub = setupUserEnvironmentCreatedSubscription()
  const userEnvironmentUpdatedSub = setupUserEnvironmentUpdatedSubscription()
  const userEnvironmentDeletedSub = setupUserEnvironmentDeletedSubscription()

  subs = [
    userEnvironmentCreatedSub,
    userEnvironmentUpdatedSub,
    userEnvironmentDeletedSub,
  ]

  return () => {
    subs.forEach((sub) => sub.unsubscribe())
  }
}

async function loadUserEnvironments() {
  const res = await getUserEnvironments()

  if (E.isRight(res)) {
    const environments = res.right.me.environments

    if (environments.length > 0) {
      runDispatchWithOutSyncing(() => {
        const formatedEnvironments = environments.map(
          (env) =>
            <Environment>{
              id: env.id,
              name: env.name,
              variables: JSON.parse(env.variables),
            }
        )

        replaceEnvironments(
          formatedEnvironments.map((environment) => {
            const parsedEnv = Environment.safeParse(environment)

            return parsedEnv.type === "ok"
              ? parsedEnv.value
              : {
                  ...environment,
                  v: EnvironmentSchemaVersion,
                }
          })
        )
      })
    }
  }
}

async function loadGlobalEnvironments() {
  const res = await getGlobalEnvironments()

  if (E.isRight(res)) {
    const globalEnv = res.right.me.globalEnvironments

    if (globalEnv) {
      const globalEnvVariableEntries = JSON.parse(globalEnv.variables)

      const result = entityReference(GlobalEnvironment).safeParse(
        globalEnvVariableEntries
      )

      runDispatchWithOutSyncing(() => {
        setGlobalEnvVariables(
          result.success ? result.data : globalEnvVariableEntries
        )
        setGlobalEnvID(globalEnv.id)
      })
    }
  } else if (res.left.error == "user_environment/user_env_does_not_exists") {
    const res = await createUserGlobalEnvironment(JSON.stringify([]))

    if (E.isRight(res)) {
      const backendId = res.right.createUserGlobalEnvironment.id
      setGlobalEnvID(backendId)
    }
  }
}

async function loadAllEnvironments() {
  await loadUserEnvironments()
  await loadGlobalEnvironments()
}

function setupUserEnvironmentCreatedSubscription() {
  const [userEnvironmentCreated$, userEnvironmentCreatedSub] =
    runUserEnvironmentCreatedSubscription()

  userEnvironmentCreated$.subscribe((res) => {
    if (E.isRight(res)) {
      const { name, variables, id } = res.right.userEnvironmentCreated

      const isAlreadyExisting = environmentsStore.value.environments.some(
        (env) => env.id == id
      )

      if (name && !isAlreadyExisting) {
        runDispatchWithOutSyncing(() => {
          createEnvironment(name, JSON.parse(variables), id)
        })
      }
    }
  })

  return userEnvironmentCreatedSub
}

function setupUserEnvironmentUpdatedSubscription() {
  const [userEnvironmentUpdated$, userEnvironmentUpdatedSub] =
    runUserEnvironmentUpdatedSubscription()

  userEnvironmentUpdated$.subscribe((res) => {
    if (E.isRight(res)) {
      const { name, variables, id, isGlobal } = res.right.userEnvironmentUpdated

      // handle the case for global environments
      if (isGlobal) {
        runDispatchWithOutSyncing(() => {
          setGlobalEnvVariables(JSON.parse(variables))
        })
      } else {
        // handle the case for normal environments

        const localIndex = environmentsStore.value.environments.findIndex(
          (env) => env.id == id
        )

        if ((localIndex || localIndex == 0) && name) {
          const environment = {
            id,
            name,
            variables: JSON.parse(variables),
          }

          const parsedEnvResult = Environment.safeParse(environment)

          const parsedEnv: Environment =
            parsedEnvResult.type === "ok"
              ? parsedEnvResult.value
              : {
                  ...environment,
                  v: EnvironmentSchemaVersion,
                }

          runDispatchWithOutSyncing(() => {
            updateEnvironment(localIndex, parsedEnv)
          })
        }
      }
    }
  })

  return userEnvironmentUpdatedSub
}

function setupUserEnvironmentDeletedSubscription() {
  const [userEnvironmentDeleted$, userEnvironmentDeletedSub] =
    runUserEnvironmentDeletedSubscription()

  userEnvironmentDeleted$.subscribe((res) => {
    if (E.isRight(res)) {
      const { id } = res.right.userEnvironmentDeleted

      // TODO: move getLocalIndexByID to a getter in the environmentsStore
      const localIndex = getLocalIndexByEnvironmentID(id)

      if (localIndex || localIndex === 0) {
        runDispatchWithOutSyncing(() => {
          deleteEnvironment(localIndex)
        })
      }
    }
  })

  return userEnvironmentDeletedSub
}
