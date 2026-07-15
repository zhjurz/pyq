import { DataTypes, Model, Optional } from "sequelize";
import sequelize from "../config/database";

interface MusicPlaylistAttributes {
  id: string;
  slug: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

type MusicPlaylistCreationAttributes = Optional<MusicPlaylistAttributes, "id" | "createdAt" | "updatedAt">;

class MusicPlaylist
  extends Model<MusicPlaylistAttributes, MusicPlaylistCreationAttributes>
  implements MusicPlaylistAttributes
{
  declare id: string;
  declare slug: string;
  declare name: string;
  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;
}

MusicPlaylist.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    slug: {
      type: DataTypes.STRING(64),
      allowNull: false,
      unique: true,
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      defaultValue: "网站歌单",
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
    tableName: "music_playlists",
    underscored: true,
  }
);

export default MusicPlaylist;
