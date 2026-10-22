# Android build and release (CI)

The `android` job in `.github/workflows/ci.yml` builds the APK.

| Event | Result |
| --- | --- |
| Pull request, push to `feat/**` | Debug APK as the workflow artifact `protocolo-debug-apk` (kept 7 days) |
| Push to `main`, signing secrets set | Separate `release` job (after all other jobs): signed release APK published as GitHub Release `v0.1.<run number>` with the file `protocolo-0.1.<run number>.apk` |
| Push to `main`, a secret missing | `release` job warns and does nothing; debug artifact still produced |

A push or PR that only changes documentation (`docs/**`, `*.md`) skips every build job, the APK and the release included
(the `changes` job decides; Privacy still runs).

`versionCode` is the run number and `versionName` is `0.1.<run number>`, passed to Gradle with `-P`.

## Create the keystore (once)

```sh
keytool -genkeypair -v -keystore protocolo.jks -alias protocolo -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 protocolo.jks
```

`keytool` asks for the keystore password, the key password and some identity fields. Keep `protocolo.jks` and both passwords
in a password manager: every future update must be signed with the same key, or Android refuses to install it over the old one.
Never commit the file (`*.jks` and `*.keystore` are gitignored).

## Create the 4 secrets

GitHub, repository, Settings, Secrets and variables, Actions, New repository secret:

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | The output of `base64 -w0 protocolo.jks` |
| `ANDROID_KEYSTORE_PASSWORD` | The keystore password |
| `ANDROID_KEY_ALIAS` | `protocolo` (the `-alias` above) |
| `ANDROID_KEY_PASSWORD` | The key password |

On `main`, CI decodes the keystore and writes its `keystore.properties` under the runner's temp directory (outside the
workspace; `app/build.gradle` finds it through `ANDROID_KEYSTORE_PROPERTIES`), and deletes both right after
`assembleRelease`, before the release is published with `gh release create` (or `gh release upload --clobber` when the tag
exists). The release job waits for every other job (backend, frontend, image, E2E, debug APK). Locally, a gitignored
`frontend/android/keystore.properties` still works.

## Install the APK on the phone

1. Open the repository's Releases page on the phone and download `protocolo-0.1.<n>.apk` (for a branch build, download the
   `protocolo-debug-apk` artifact from the workflow run on a computer and send the APK to the phone).
2. Open the file. Android asks to allow installs from this source (the browser or file manager): allow it ("Instalar apps
   desconhecidos").
3. Install. A newer release installs over the old one and keeps the local data, as long as it is signed with the same key.
4. In the app, open Diagnóstico to check the version and test notifications and camera permissions.

## Local build

```sh
cd frontend
VITE_API_URL=https://protocolo.frauchesgabriel.work npm run cap:sync
cd android && ./gradlew assembleDebug   # app/build/outputs/apk/debug/app-debug.apk
```
