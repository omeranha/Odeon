export interface ProfileSettings {
  // Missing on profiles saved before the setting existed, which counts as on.
  autoplay?: boolean
}

export const defaultProfileSettings: ProfileSettings = {
  autoplay: true,
}
