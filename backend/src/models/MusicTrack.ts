import { DataTypes, Model, Optional } from "sequelize";
import sequelize from "../config/database";

interface MusicTrackAttributes {
  id: string;
  playlistId: string;
  audioMediaId: string;
  coverMediaId: string | null;
  title: string;
  artist: string;
  lrc: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

type MusicTrackCreationAttributes = Optional<
  MusicTrackAttributes,
  "id" | "coverMediaId" | "artist" | "lrc" | "sortOrder" | "createdAt" | "updatedAt"
>;

class MusicTrack
  extends Model<MusicTrackAttributes, MusicTrackCreationAttributes>
  implements MusicTrackAttributes
{
  declare id: string;
  declare playlistId: string;
  declare audioMediaId: string;
  declare coverMediaId: string | null;
  declare title: string;
  declare artist: string;
  declare lrc: string;
  declare sortOrder: number;
  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;
}

MusicTrack.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    playlistId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: "playlist_id",
    },
    audioMediaId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: "audio_media_id",
    },
    coverMediaId: {
      type: DataTypes.UUID,
      allowNull: true,
      defaultValue: null,
      field: "cover_media_id",
    },
    title: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    artist: {
      type: DataTypes.STRING(255),
      allowNull: false,
      defaultValue: "",
    },
    lrc: {
      type: DataTypes.TEXT,
      allowNull: false,
      defaultValue: "",
    },
    sortOrder: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      field: "sort_order",
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    updatedAt: {
      type: DataTypes.DATE,
      allowNull: false,
    },
  },
  {
    sequelize,
    tableName: "music_tracks",
    underscored: true,
    indexes: [
      { unique: true, fields: ["playlist_id", "sort_order"] },
      { fields: ["audio_media_id"] },
      { fields: ["cover_media_id"] },
    ],
  }
);

export default MusicTrack;
