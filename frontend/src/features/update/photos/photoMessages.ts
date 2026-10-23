/** The photo types the server takes (FileRules); anything else must become a JPEG on the device first. */
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp']
export const UNSUPPORTED_PHOTO_MESSAGE = 'Formato de foto não suportado. Tire a foto pela câmera do app ou escolha JPG/PNG.'
export const uploadFailedMessage = (poseLabel: string) => `Não foi possível enviar a foto de ${poseLabel}. Tente de novo.`
