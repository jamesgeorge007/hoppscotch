import * as E from "fp-ts/Either"
import { Ref } from "vue"

import {
  Environment,
  HoppCollection,
  HoppGQLRequest,
  HoppRESTRequest,
} from "@hoppscotch/data"
import { HandleRef } from "./handle"
import {
  RESTCollectionChildrenView,
  RESTCollectionJSONView,
  RESTCollectionLevelAuthHeadersView,
  RESTSearchResultsView,
  RootRESTCollectionView,
} from "./view"
import {
  Workspace,
  WorkspaceCollection,
  WorkspaceDecor,
  WorkspaceEnvironment,
  WorkspaceRequest,
} from "./workspace"

export interface WorkspaceProvider {
  providerID: string

  workspaceDecor?: Ref<WorkspaceDecor>

  getWorkspaceHandle(
    workspaceID: string
  ): Promise<E.Either<unknown, HandleRef<Workspace>>>
  getCollectionHandle(
    workspaceHandle: HandleRef<Workspace>,
    collectionID: string
  ): Promise<E.Either<unknown, HandleRef<WorkspaceCollection>>>
  getRequestHandle(
    workspaceHandle: HandleRef<Workspace>,
    requestID: string
  ): Promise<E.Either<unknown, HandleRef<WorkspaceRequest>>>

  getRESTRootCollectionView(
    workspaceHandle: HandleRef<Workspace>
  ): Promise<E.Either<never, HandleRef<RootRESTCollectionView>>>
  getRESTCollectionChildrenView(
    collectionHandle: HandleRef<WorkspaceCollection>
  ): Promise<E.Either<never, HandleRef<RESTCollectionChildrenView>>>
  getRESTCollectionLevelAuthHeadersView(
    collectionHandle: HandleRef<WorkspaceCollection>
  ): Promise<E.Either<never, HandleRef<RESTCollectionLevelAuthHeadersView>>>
  getRESTSearchResultsView(
    workspaceHandle: HandleRef<Workspace>,
    searchQuery: Ref<string>
  ): Promise<E.Either<never, HandleRef<RESTSearchResultsView>>>
  getRESTCollectionJSONView(
    workspaceHandle: HandleRef<Workspace>
  ): Promise<E.Either<never, HandleRef<RESTCollectionJSONView>>>

  getGQLCollectionLevelAuthHeadersView(
    collectionHandle: HandleRef<WorkspaceCollection>
  ): Promise<E.Either<never, HandleRef<RESTCollectionLevelAuthHeadersView>>>
  getGQLSearchResultsView(
    workspaceHandle: HandleRef<Workspace>,
    searchQuery: Ref<string>
  ): Promise<E.Either<never, HandleRef<RESTSearchResultsView>>>

  createRESTRootCollection(
    workspaceHandle: HandleRef<Workspace>,
    newCollection: Partial<Exclude<HoppCollection, "id">> & { name: string }
  ): Promise<E.Either<unknown, HandleRef<WorkspaceCollection>>>
  createRESTChildCollection(
    parentCollectionHandle: HandleRef<WorkspaceCollection>,
    newChildCollection: Partial<HoppCollection> & { name: string }
  ): Promise<E.Either<unknown, HandleRef<WorkspaceCollection>>>
  updateRESTCollection(
    collectionHandle: HandleRef<WorkspaceCollection>,
    updatedCollection: Partial<HoppCollection>
  ): Promise<E.Either<unknown, void>>
  removeRESTCollection(
    collectionHandle: HandleRef<WorkspaceCollection>
  ): Promise<E.Either<unknown, void>>
  createRESTRequest(
    parentCollectionHandle: HandleRef<WorkspaceCollection>,
    newRequest: HoppRESTRequest
  ): Promise<E.Either<unknown, HandleRef<WorkspaceRequest>>>
  updateRESTRequest(
    requestHandle: HandleRef<WorkspaceRequest>,
    updatedRequest: Partial<HoppRESTRequest>
  ): Promise<E.Either<unknown, void>>
  removeRESTRequest(
    requestHandle: HandleRef<WorkspaceRequest>
  ): Promise<E.Either<unknown, void>>

  importRESTCollections(
    workspaceHandle: HandleRef<Workspace>,
    collections: HoppCollection[]
  ): Promise<E.Either<unknown, HandleRef<WorkspaceCollection>>>
  exportRESTCollections(
    workspaceHandle: HandleRef<Workspace>,
    collections: HoppCollection[]
  ): Promise<E.Either<unknown, void>>
  exportRESTCollection(
    collectionHandle: HandleRef<WorkspaceCollection>,
    collection: HoppCollection
  ): Promise<E.Either<unknown, void>>

  reorderRESTCollection(
    collectionHandle: HandleRef<WorkspaceCollection>,
    destinationCollectionID: string | null
  ): Promise<E.Either<unknown, void>>
  moveRESTCollection(
    collectionHandle: HandleRef<WorkspaceCollection>,
    destinationCollectionID: string | null
  ): Promise<E.Either<unknown, void>>
  reorderRESTRequest(
    requestHandle: HandleRef<WorkspaceRequest>,
    destinationCollectionID: string,
    destinationRequestID: string | null
  ): Promise<E.Either<unknown, void>>
  moveRESTRequest(
    requestHandle: HandleRef<WorkspaceRequest>,
    destinationCollectionID: string
  ): Promise<E.Either<unknown, void>>

  createGQLRootCollection(
    workspaceHandle: HandleRef<Workspace>,
    newCollection: Partial<Exclude<HoppCollection, "id">> & { name: string }
  ): Promise<E.Either<unknown, HandleRef<WorkspaceCollection>>>
  createGQLChildCollection(
    parentCollectionHandle: HandleRef<WorkspaceCollection>,
    newChildCollection: Partial<HoppCollection> & { name: string }
  ): Promise<E.Either<unknown, HandleRef<WorkspaceCollection>>>
  updateGQLCollection(
    collectionHandle: HandleRef<WorkspaceCollection>,
    updatedCollection: Partial<HoppCollection>
  ): Promise<E.Either<unknown, void>>
  removeGQLCollection(
    collectionHandle: HandleRef<WorkspaceCollection>
  ): Promise<E.Either<unknown, void>>
  createGQLRequest(
    parentCollectionHandle: HandleRef<WorkspaceCollection>,
    newRequest: HoppGQLRequest
  ): Promise<E.Either<unknown, HandleRef<WorkspaceRequest>>>
  updateGQLRequest(
    requestHandle: HandleRef<WorkspaceRequest>,
    updatedRequest: Partial<HoppGQLRequest>
  ): Promise<E.Either<unknown, void>>
  removeGQLRequest(
    requestHandle: HandleRef<WorkspaceRequest>
  ): Promise<E.Either<unknown, void>>

  importGQLCollections(
    workspaceHandle: HandleRef<Workspace>,
    collections: HoppCollection[]
  ): Promise<E.Either<unknown, HandleRef<WorkspaceCollection>>>
  exportGQLCollections(
    workspaceHandle: HandleRef<Workspace>,
    collections: HoppCollection[]
  ): Promise<E.Either<unknown, void>>
  exportGQLCollection(
    collectionHandle: HandleRef<WorkspaceCollection>,
    collection: HoppCollection
  ): Promise<E.Either<unknown, void>>

  createRESTEnvironment(
    workspaceHandle: HandleRef<Workspace>,
    newEnvironment: Partial<Environment> & { name: string }
  ): Promise<E.Either<unknown, HandleRef<WorkspaceEnvironment>>>

  duplicateRESTEnvironment(
    environmentHandle: HandleRef<WorkspaceEnvironment>
  ): Promise<E.Either<unknown, void>>

  updateRESTEnvironment(
    environmentHandle: HandleRef<WorkspaceEnvironment>,
    updatedEnvironment: Partial<Environment>
  ): Promise<E.Either<unknown, void>>

  removeRESTEnvironment(
    environmentHandle: HandleRef<WorkspaceEnvironment>
  ): Promise<E.Either<unknown, void>>
}
