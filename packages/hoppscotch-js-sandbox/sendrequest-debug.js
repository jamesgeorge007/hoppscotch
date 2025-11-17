// Quick debug script to test pm.sendRequest execution
import { runTestScript } from "./dist/node/index.js"

const script = `
console.log("1. Script starts")

pm.test("sendRequest test", function() {
  console.log("2. Test function executes")
  
  pm.sendRequest("https://echo.hoppscotch.io/", function(err, response) {
    console.log("3. Callback executes!", err, response)
    pm.expect(err).to.equal(null)
    pm.expect(response.code).to.equal(200)
  })
  
  console.log("4. After pm.sendRequest call")
})

console.log("5. Script ends")
`

const mockFetch = async (request) => {
  console.log("FETCH CALLED:", request.url)
  return {
    status: 200,
    statusText: "OK",
    headers: {},
    body: "test",
  }
}

runTestScript(script, {
  envs: { global: [], selected: [] },
  request: { method: "GET", endpoint: "http://test.com", headers: [] },
  response: { status: 200, body: "test", headers: [] },
  cookies: null,
  experimentalScriptingSandbox: true,
  hoppFetchHook: mockFetch,
})()
  .then((result) => {
    console.log("\n=== RESULT ===")
    if (result._tag === "Right") {
      console.log("Tests:", JSON.stringify(result.right.tests, null, 2))
    } else {
      console.log("Error:", result.left)
    }
  })
  .catch((err) => {
    console.error("Caught error:", err)
  })
