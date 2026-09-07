const mongoose = require('mongoose');
const { Schema } = mongoose;

const invitationSchema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  role: { type: String, enum: ['owner', 'admin', 'maintainer', 'developer', 'viewer'], default: 'developer' },
  tokenHash: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true },
  status: { type: String, enum: ['pending', 'accepted', 'expired'], default: 'pending' },
  // OTP-based acceptance: the invite email carries a 6-digit code (only its
  // SHA-256 hash is stored) that the invitee enters on the login page to
  // accept the invitation. Replaces the old plaintext temporary-password email.
  otpHash: { type: String, default: null },
  otpExpiresAt: { type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.model('Invitation', invitationSchema);