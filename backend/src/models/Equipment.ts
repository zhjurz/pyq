import { DataTypes, Model, Optional } from "sequelize";
import sequelize from "../config/database";

interface EquipmentAttributes {
  id: string;
  category: string;
  categoryDesc: string;
  name: string;
  spec: string;
  intro: string;
  image: string;
  link: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

interface EquipmentCreationAttributes extends Optional<EquipmentAttributes, "id" | "spec" | "intro" | "image" | "link" | "sortOrder" | "createdAt" | "updatedAt"> {}

class Equipment extends Model<EquipmentAttributes, EquipmentCreationAttributes> implements EquipmentAttributes {
  declare id: string;
  declare category: string;
  declare categoryDesc: string;
  declare name: string;
  declare spec: string;
  declare intro: string;
  declare image: string;
  declare link: string;
  declare sortOrder: number;
  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;
}

Equipment.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    category: { type: DataTypes.STRING(100), allowNull: false, defaultValue: "" },
    categoryDesc: { type: DataTypes.STRING(255), allowNull: false, defaultValue: "" },
    name: { type: DataTypes.STRING(200), allowNull: false },
    spec: { type: DataTypes.STRING(300), allowNull: false, defaultValue: "" },
    intro: { type: DataTypes.STRING(500), allowNull: false, defaultValue: "" },
    image: { type: DataTypes.STRING(512), allowNull: false, defaultValue: "" },
    link: { type: DataTypes.STRING(512), allowNull: false, defaultValue: "" },
    sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false },
  },
  { sequelize, tableName: "equipment", underscored: true }
);

export default Equipment;
